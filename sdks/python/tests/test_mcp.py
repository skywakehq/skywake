"""The MCP index tools, through an MCP client in the same process: against a
fake API always, and against a real one when SKYWAKE_URL and
SKYWAKE_API_ADMIN_TOKEN are set."""

import asyncio
import json
import os
import time

import httpx
import pytest

mcp = pytest.importorskip("mcp")

from skywake import Skywake  # noqa: E402
from skywake import mcp as server  # noqa: E402

SCHEMA = {
    "vectors": [{"name": "embedding", "dims": 2, "metric": "cosine"}],
    "attributes": [{"name": "tag", "type": "string"}, {"name": "price", "type": "number"}],
}


def call(tool, arguments=None):
    """Calls a tool as an agent would, and returns its result."""

    async def run():
        async with mcp.Client(server.server) as client:
            return await client.call_tool(tool, arguments or {})

    return asyncio.run(run())


def answer(result):
    assert not result.is_error, result.content[0].text
    if result.structured_content is not None:
        return result.structured_content.get("result", result.structured_content)
    return json.loads(result.content[0].text)


def fake_api(handle):
    seen = []

    def record(request):
        seen.append(request)
        return handle(request)

    server.state.clear()
    server.state["sky"] = Skywake("http://api", "sw_key", transport=httpx.MockTransport(record), backoff=0.001)
    return seen


def test_the_index_tools_have_tight_schemas():
    async def run():
        async with mcp.Client(server.server) as client:
            return {tool.name: tool for tool in (await client.list_tools()).tools}

    tools = asyncio.run(run())
    for name in [
        "list_indexes",
        "describe_index",
        "query_index",
        "search_index",
        "hybrid_search_index",
        "upsert_documents",
        "delete_documents",
        "fork_index_branch",
    ]:
        assert tools[name].description
    query = tools["query_index"].input_schema
    assert query["required"] == ["index", "vector"]
    assert query["properties"]["top_k"]["maximum"] == 1000
    assert tools["query_index"].annotations.read_only_hint
    assert tools["search_index"].input_schema["required"] == ["index", "query"]
    assert tools["hybrid_search_index"].annotations.read_only_hint
    assert tools["delete_documents"].annotations.destructive_hint
    for name in ["list_files", "read_file", "search", "diff", "log"]:
        assert tools[name].annotations.read_only_hint, name
    upsert = tools["upsert_documents"].input_schema
    assert upsert["properties"]["documents"]["maxItems"] == 1000


def test_a_query_picks_the_only_column_and_returns_every_attribute():
    def handle(request):
        if request.method == "GET":
            return httpx.Response(200, json={"name": "shop", "schema": SCHEMA, "stats": None})
        return httpx.Response(200, json={"hits": [{"id": 1, "distance": 0.1, "attributes": {"tag": "a"}}]})

    seen = fake_api(handle)
    flt = {"price": {"lt": 10}}
    hits = answer(call("query_index", {"index": "prod/shop", "vector": [1, 0], "filter": flt, "branch": "try"}))
    assert hits == [{"id": 1, "distance": 0.1, "attributes": {"tag": "a"}}]
    sent = seen[-1]
    assert sent.url.raw_path.decode() == "/v1/indexes/prod%2Fshop/branches/try/query"
    assert json.loads(sent.content) == {
        "vector": {"column": "embedding", "value": [1.0, 0.0]},
        "topK": 10,
        "filter": flt,
        "include": ["tag", "price"],
    }


def test_an_api_error_reaches_the_agent():
    def handle(request):
        if request.method == "GET":
            return httpx.Response(200, json={"name": "shop", "schema": SCHEMA, "stats": None})
        error = {"error": "filter.price.lt: must be number", "code": "invalid", "path": "filter.price.lt"}
        return httpx.Response(400, json=error)

    fake_api(handle)
    result = call("query_index", {"index": "shop", "vector": [1, 0], "filter": {"price": {"lt": "x"}}})
    assert result.is_error
    assert "filter.price.lt: must be number" in result.content[0].text


def test_a_bad_argument_is_refused_before_the_api():
    seen = fake_api(lambda request: httpx.Response(500))
    assert call("query_index", {"index": "shop", "vector": [], "top_k": 5}).is_error
    assert call("upsert_documents", {"index": "shop", "documents": [{"id": 1}]}).is_error
    assert seen == []


EMBEDDED = {
    "vectors": [
        {"name": "embedding", "dims": 2, "metric": "cosine", "embed": {"model": "text-embedding-3-small"}},
        {"name": "raw", "dims": 2, "metric": "cosine"},
    ],
    "attributes": [{"name": "body", "type": "text"}],
}


def index_api(schema, hits):
    """A fake API with one index of `schema`, whose reads find `hits`."""

    def handle(request):
        if request.method == "GET":
            return httpx.Response(200, json={"name": "docs", "schema": schema, "stats": None})
        return httpx.Response(200, json={"hits": hits})

    return fake_api(handle)


def test_a_text_search_sends_fields_filter_and_highlight():
    hit = {"id": 1, "score": 2.5, "attributes": {"body": "reset it"}, "highlights": {}}
    seen = index_api(EMBEDDED, [hit])
    arguments = {
        "index": "docs",
        "query": "reset password",
        "fields": ["body"],
        "filter": {"body": {"phrase": "reset"}},
        "highlight": ["body"],
        "top_k": 3,
    }
    assert answer(call("search_index", arguments)) == [hit]
    assert seen[-1].url.path == "/v1/indexes/docs/branches/main/search"
    assert json.loads(seen[-1].content) == {
        "query": "reset password",
        "topK": 3,
        "fields": ["body"],
        "filter": {"body": {"phrase": "reset"}},
        "include": ["body"],
        "highlight": ["body"],
    }


def test_a_query_with_text_uses_the_column_that_embeds_it():
    seen = index_api(EMBEDDED, [])
    assert answer(call("query_index", {"index": "docs", "vector": "reset password"})) == []
    assert json.loads(seen[-1].content)["vector"] == {"column": "embedding", "value": "reset password"}

    posts = len([r for r in seen if r.method == "POST"])
    result = call("query_index", {"index": "docs", "vector": "reset", "column": "raw"})
    assert result.is_error
    assert "`raw` does not embed text" in result.content[0].text
    assert len([r for r in seen if r.method == "POST"]) == posts


def test_a_hybrid_search_fuses_words_and_meaning():
    seen = index_api(EMBEDDED, [])
    arguments = {"index": "docs", "query": "reset", "highlight": ["body"], "filter": {"body": {"prefix": "re"}}}
    assert answer(call("hybrid_search_index", arguments)) == []
    assert seen[-1].url.path == "/v1/indexes/docs/branches/main/hybrid"
    shared = {"topK": 50, "filter": {"body": {"prefix": "re"}}, "include": ["body"]}
    assert json.loads(seen[-1].content) == {
        "searches": {
            "words": {"query": "reset", "highlight": ["body"], **shared},
            "meaning": {"vector": {"column": "embedding", "value": "reset"}, **shared},
        },
        "topK": 10,
        "fuse": {},
    }

    hybrid = call("hybrid_search_index", {"index": "docs", "query": "reset", "vector": [1, 0], "column": "raw"})
    assert json.loads(seen[-1].content)["searches"]["meaning"]["vector"] == {"column": "raw", "value": [1.0, 0.0]}
    assert not hybrid.is_error


def test_a_hybrid_search_needs_a_vector_when_no_column_embeds_text():
    seen = index_api(SCHEMA, [])
    result = call("hybrid_search_index", {"index": "docs", "query": "reset"})
    assert result.is_error
    assert "no vector column that embeds text" in result.content[0].text
    assert [r.method for r in seen] == ["GET"]


# Starting the server, against a fake API.

ENV = {
    "SKYWAKE_URL": "http://api",
    "SKYWAKE_KEY": "sw_key",
    "SKYWAKE_NAMESPACE": "prod/app",
    "SKYWAKE_BRANCH": "agents/1",
    "SKYWAKE_FORK_FROM": "main",
}


@pytest.fixture
def start(monkeypatch):
    """Runs the server's start against `handle`, and puts back the tools it removes."""
    tools = dict(server.server._tool_manager._tools)
    seen = []

    def run(handle, env=ENV):
        def record(request):
            seen.append((request.method, request.url.raw_path.decode()))
            return handle(request)

        transport = httpx.MockTransport(record)
        monkeypatch.setattr(server, "Skywake", lambda url, key: Skywake(url, key, transport=transport, backoff=0.001))
        server.state.clear()
        return server._start(env)

    yield run, seen
    server.server._tool_manager._tools = tools
    server.state.clear()


def tool_names():
    async def run():
        async with mcp.Client(server.server) as client:
            return {tool.name for tool in (await client.list_tools()).tools}

    return asyncio.run(run())


def test_a_second_start_reuses_the_fork(start):
    run, seen = start

    def handle(request):
        if request.url.path.endswith("/sessions"):
            return httpx.Response(201, json={"id": "s1"})
        return httpx.Response(409, json={"error": "branch `agents/1` already exists", "code": "conflict"})

    session = run(handle)
    assert session.id == "s1"
    assert ("POST", "/v1/namespaces/prod%2Fapp/branches") in seen
    assert server.state["branch"] == "agents/1"
    assert server.state["session"] is session  # the write tools commit with it
    assert "write_files" in tool_names()


def test_a_failed_fork_ends_the_session(start):
    run, seen = start

    def handle(request):
        if request.url.path.endswith("/sessions"):
            return httpx.Response(201, json={"id": "s1"})
        if request.method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(404, json={"error": "no branch `main`", "code": "not_found"})

    with pytest.raises(server.SkywakeError):
        run(handle)
    assert seen[-1] == ("DELETE", "/v1/namespaces/prod%2Fapp/sessions/s1")


def read_only(branch_found):
    def handle(request):
        path = request.url.path
        if path.endswith("/sessions"):
            return httpx.Response(403, json={"error": "this needs the `write` role", "code": "forbidden"})
        if path.endswith("/branches"):
            return httpx.Response(200, json=[])
        if branch_found:
            return httpx.Response(200, json={"name": "agents/1"})
        return httpx.Response(404, json={"error": "no branch `agents/1`", "code": "not_found"})

    return handle


def test_a_read_only_key_starts_without_a_session_or_write_tools(start):
    run, seen = start
    assert run(read_only(branch_found=True)) is None
    names = tool_names()
    assert {"read_file", "list_files", "query_index", "search_index"} <= names
    assert not names & set(server.WRITE_TOOLS)
    assert ("POST", "/v1/namespaces/prod%2Fapp/branches") not in seen


def test_a_read_only_key_cannot_fork_a_missing_branch(start):
    run, _ = start
    with pytest.raises(ValueError, match="read-only key can't fork it"):
        run(read_only(branch_found=False))


def test_a_key_without_the_namespace_does_not_start(start):
    run, _ = start
    no_access = httpx.Response(403, json={"error": "no access to `prod/app`", "code": "forbidden"})
    with pytest.raises(server.SkywakeError, match="no access"):
        run(lambda request: no_access)


def test_a_startup_error_reaches_the_agent_on_every_tool(start, monkeypatch):
    run, _ = start
    with pytest.raises(ValueError, match="SKYWAKE_URL and SKYWAKE_KEY"):
        run(lambda request: httpx.Response(500), env={})

    # What main does with it, without serving stdio.
    monkeypatch.setattr(server.server, "run", lambda: None)
    monkeypatch.setattr(os, "environ", {})
    server.main()
    result = call("list_indexes")
    assert result.is_error
    assert result.content[0].text.endswith("skywake-mcp could not start: set SKYWAKE_URL and SKYWAKE_KEY")


@pytest.mark.skipif(
    not (os.environ.get("SKYWAKE_URL") and os.environ.get("SKYWAKE_API_ADMIN_TOKEN")),
    reason="needs a running API: SKYWAKE_URL and SKYWAKE_API_ADMIN_TOKEN",
)
def test_every_index_tool_against_the_api():
    url = os.environ["SKYWAKE_URL"]
    made = httpx.post(
        f"{url}/v1/orgs",
        headers={"Authorization": f"Bearer {os.environ['SKYWAKE_API_ADMIN_TOKEN']}"},
        json={"name": f"mcp-{time.time_ns()}"},
    )
    made.raise_for_status()
    sky = Skywake(url, made.json()["key"])
    server.state.clear()
    server.state["sky"] = sky
    sky.indexes.create("test/shop", SCHEMA["vectors"], SCHEMA["attributes"])

    assert answer(call("list_indexes")) == [{"name": "test/shop", **SCHEMA}]
    documents = [
        {"id": 1, "vectors": {"embedding": [1, 0]}, "attributes": {"tag": "a", "price": 5}},
        {"id": "two", "vectors": {"embedding": [0, 1]}, "attributes": {"tag": "b", "price": 50}},
    ]
    assert answer(call("upsert_documents", {"index": "test/shop", "documents": documents})) == {"count": 2}
    hits = answer(call("query_index", {"index": "test/shop", "vector": [1, 0.1], "top_k": 5}))
    assert [hit["id"] for hit in hits] == [1, "two"]
    assert hits[0]["attributes"] == {"tag": "a", "price": 5}
    hits = answer(call("query_index", {"index": "test/shop", "vector": [1, 0], "filter": {"price": {"gt": 10}}}))
    assert [hit["id"] for hit in hits] == ["two"]

    forked = answer(call("fork_index_branch", {"index": "test/shop", "name": "agents/try"}))
    assert forked == {"index": "test/shop", "branch": "agents/try", "forked_from": "main"}
    assert answer(call("delete_documents", {"index": "test/shop", "ids": [1], "branch": "agents/try"})) == {"count": 1}
    on_fork = answer(call("query_index", {"index": "test/shop", "vector": [1, 0], "branch": "agents/try"}))
    assert [hit["id"] for hit in on_fork] == ["two"]
    on_main = answer(call("query_index", {"index": "test/shop", "vector": [1, 0]}))
    assert [hit["id"] for hit in on_main] == [1, "two"]

    described = answer(call("describe_index", {"index": "test/shop", "branch": "agents/try"}))
    assert described["schema"] == SCHEMA
    assert described["branches"] == ["agents/try", "main"]
    assert described["stats"]["rows"] == 1
    sky.indexes.delete("test/shop")
