import json

import httpx
import pytest
from skywake import Skywake, SkywakeError


def recorder(answer):
    """A transport that answers with `answer(request)` and records each request."""
    seen = []

    def handle(request):
        seen.append(request)
        return answer(request)

    return httpx.MockTransport(handle), seen


def client(transport):
    return Skywake("http://api", "sw_key", transport=transport, backoff=0.001)


def body(request):
    return json.loads(request.content) if request.content else None


def test_an_upsert_is_sent_1000_documents_at_a_time_to_the_branch_picked():
    transport, seen = recorder(lambda r: httpx.Response(200, json={"count": len(body(r)["documents"])}))
    docs = [{"id": i, "vectors": {"v": [i, 0]}} for i in range(2500)]
    assert client(transport).index("prod/products").at("agents/try").upsert(docs) == 2500
    assert [(r.method, r.url.raw_path.decode(), len(body(r)["documents"])) for r in seen] == [
        ("POST", "/v1/indexes/prod%2Fproducts/branches/agents%2Ftry/documents", 1000),
        ("POST", "/v1/indexes/prod%2Fproducts/branches/agents%2Ftry/documents", 1000),
        ("POST", "/v1/indexes/prod%2Fproducts/branches/agents%2Ftry/documents", 500),
    ]


def test_a_query_sends_readable_json_and_leaves_out_what_is_not_given():
    hits = [{"id": "a", "distance": 0.1, "attributes": {}}]
    transport, seen = recorder(lambda r: httpx.Response(200, json={"hits": hits}))
    flt = {"and": [{"tag": {"eq": "billing"}}, {"price": {"lt": 10}}]}
    assert client(transport).index("products").query("embedding", [0.1, 0.2], top_k=5, filter=flt) == hits
    assert seen[0].url.path == "/v1/indexes/products/branches/main/query"
    assert body(seen[0]) == {"vector": {"column": "embedding", "value": [0.1, 0.2]}, "topK": 5, "filter": flt}


def test_a_query_sends_ids_exclusions_limits_and_consistency_and_gives_performance():
    performance = {"server_ms": 3, "cache_temperature": "warm", "cache_hit_ratio": 0.5}
    answer = {"hits": [], "performance": performance, "billing": {"queries": 1}}
    transport, seen = recorder(lambda r: httpx.Response(200, json=answer))
    per = {"attributes": ["file"], "limit": 3}
    hits = (
        client(transport)
        .index("docs")
        .query(
            "embedding",
            [0.1],
            filter={"id": {"in": [1, "two"]}},
            exclude=["body"],
            per=per,
            consistency="eventual",
        )
    )
    assert hits == [] and hits.performance == performance and hits.billing == {"queries": 1}
    sent = body(seen[0])
    assert (sent["exclude"], sent["per"], sent["consistency"]) == (["body"], per, "eventual")


def test_a_bad_field_comes_back_with_its_json_path():
    error = {
        "error": "filter.price.lt: must be number",
        "code": "invalid",
        "request_id": "r",
        "path": "filter.price.lt",
    }
    transport, seen = recorder(lambda r: httpx.Response(400, json=error))
    with pytest.raises(SkywakeError) as raised:
        client(transport).index("products").query("v", [0], filter={"price": {"lt": "x"}})
    assert (raised.value.status, raised.value.code, raised.value.path) == (400, "invalid", "filter.price.lt")
    assert len(seen) == 1


def test_fork_stats_build_and_branch_delete_go_to_the_right_routes():
    def answer(r):
        if r.method == "GET" and "/operations/" not in r.url.path:
            return httpx.Response(200, json={"name": "x", "forked_from": "main", "created": "", "stats": None})
        if r.method == "DELETE":
            return httpx.Response(204)
        if r.url.path.endswith(("/build", "/warm")):
            return httpx.Response(202, json={"id": "op_1", "status": "running"})
        if r.url.path.endswith("/recall"):
            return httpx.Response(200, json={"recall": 1})
        if r.url.path.endswith("/merge"):
            return httpx.Response(200, json={"rows": 2})
        if "/operations/" in r.url.path:
            return httpx.Response(200, json={"id": "op_1", "status": "done"})
        return httpx.Response(201, json={"name": body(r)["name"]})

    transport, seen = recorder(answer)
    main = client(transport).index("products")
    fork = main.fork("agents/x")
    assert fork.branch == "agents/x"
    assert fork.stats() is None
    assert fork.build()["id"] == "op_1"
    fork.warm()
    assert fork.operation("op_1")["status"] == "done"
    assert fork.recall(queries=5)["recall"] == 1
    assert body(seen[-1]) == {"queries": 5}
    assert main.merge("agents/x") == 2
    assert body(seen[-1]) == {"from": "agents/x"}
    fork.delete_branch()
    assert [f"{r.method} {r.url.raw_path.decode()}" for r in seen] == [
        "POST /v1/indexes/products/branches",
        "GET /v1/indexes/products/branches/agents%2Fx",
        "POST /v1/indexes/products/branches/agents%2Fx/build",
        "POST /v1/indexes/products/branches/agents%2Fx/warm",
        "GET /v1/indexes/products/operations/op_1",
        "POST /v1/indexes/products/branches/agents%2Fx/recall",
        "POST /v1/indexes/products/branches/main/merge",
        "DELETE /v1/indexes/products/branches/agents%2Fx",
    ]
    assert body(seen[0]) == {"name": "agents/x", "from": "main"}


def test_indexes_are_made_paged_read_and_deleted():
    names = [f"i{i:04}" for i in range(1001)]

    def answer(r):
        if r.method == "POST":
            return httpx.Response(201, json=body(r))
        if r.method == "DELETE":
            return httpx.Response(204)
        if r.url.path != "/v1/indexes":
            return httpx.Response(200, json={"name": "a", "stats": None})
        after = r.url.params.get("after")
        start = names.index(after) + 1 if after else 0
        return httpx.Response(200, json=[{"name": n} for n in names[start : start + 1000]])

    transport, seen = recorder(answer)
    sky = client(transport)
    text = [
        {"name": "body", "type": "text", "language": "french", "stopwords": True},
        {"name": "tag", "type": "string", "filter_index": True},
    ]
    made = sky.indexes.create("prod/a", [{"name": "v", "dims": 3}], text)
    assert made.name == "prod/a"
    assert body(seen[0]) == {"name": "prod/a", "schema": {"vectors": [{"name": "v", "dims": 3}], "attributes": text}}
    assert [index["name"] for index in sky.indexes] == names
    assert sky.indexes.get("prod/a")["name"] == "a"
    sky.indexes.update("prod/a", read_only=True)
    assert body(seen[-1]) == {"read_only": True}
    sky.indexes.update("prod/a", retention_days=None)
    assert body(seen[-1]) == {"retention_days": None}
    seen.pop()
    sky.indexes.delete("prod/a")
    assert [f"{r.method} {r.url.raw_path.decode()}" for r in seen[1:]] == [
        "GET /v1/indexes?limit=1000",
        "GET /v1/indexes?limit=1000&after=i0999",
        "GET /v1/indexes/prod%2Fa",
        "PATCH /v1/indexes/prod%2Fa",
        "DELETE /v1/indexes/prod%2Fa",
    ]


def test_an_index_is_pinned_unpinned_and_says_where():
    pinning = {"replicas": [{"server": "api-1", "warm": True, "in_flight": 2}]}
    transport, seen = recorder(
        lambda r: httpx.Response(200, json={"name": "a", "pinned": {"replicas": 1}, "pinning": pinning})
    )
    sky = client(transport)
    sky.indexes.create("a", [{"name": "v", "dims": 3}], replicas=2)
    assert body(seen[-1])["pinned"] == {"replicas": 2}
    sky.indexes.update("a", replicas=3)
    assert body(seen[-1]) == {"pinned": {"replicas": 3}}
    sky.indexes.update("a", replicas=None)
    assert body(seen[-1]) == {"pinned": None}
    info = sky.indexes.get("a")
    assert info["pinned"] == {"replicas": 1}
    assert info["pinning"] == pinning


def test_documents_come_a_page_at_a_time_by_cursor_and_one_by_id():
    def doc(id):
        return {"id": id, "vectors": {"v": [0]}, "attributes": {}}

    def answer(request):
        if "/documents/" in request.url.path:
            return httpx.Response(200, json=doc("a/b"))
        if request.url.path.endswith("/usage"):
            return httpx.Response(200, json={"days": []})
        if request.url.params.get("cursor"):
            return httpx.Response(200, json={"documents": [doc(3)], "next": None})
        return httpx.Response(200, json={"documents": [doc(1), doc(2)], "next": "c1"})

    transport, seen = recorder(answer)
    sky = client(transport)
    index = sky.index("products")
    assert [d["id"] for d in index.iter_documents()] == [1, 2, 3]
    assert index.get("a/b")["id"] == "a/b"
    assert sky.indexes.usage("products", days=7) == []
    assert [r.url.raw_path.decode() for r in seen] == [
        "/v1/indexes/products/branches/main/documents?limit=1000",
        "/v1/indexes/products/branches/main/documents?limit=1000&cursor=c1",
        "/v1/indexes/products/branches/main/documents/a%2Fb",
        "/v1/indexes/products/usage?days=7",
    ]


def test_a_query_sends_a_recall_target():
    transport, seen = recorder(lambda r: httpx.Response(200, json={"hits": []}))
    client(transport).index("products").query("embedding", [0.1], recall=0.99)
    assert body(seen[0])["recall"] == 0.99


def test_a_search_and_a_hybrid_query_send_what_is_given():
    hits = [{"id": 1, "score": 2.5, "attributes": {}, "highlights": {}}]
    transport, seen = recorder(lambda r: httpx.Response(200, json={"hits": hits}))
    index = client(transport).index("docs")
    flt = {"and": [{"body": {"phrase": "reset password"}}, {"title": {"contains_all_tokens": "reset"}}]}
    assert index.search("reset", top_k=3, boosts={"title": 2}, filter=flt) == hits
    assert seen[0].url.path == "/v1/indexes/docs/branches/main/search"
    assert body(seen[0]) == {"query": "reset", "topK": 3, "boosts": {"title": 2}, "filter": flt}
    index.search("red sho", last_as_prefix=True)
    assert body(seen.pop())["lastAsPrefix"] is True
    words = {"query": "reset", "topK": 50}
    assert index.hybrid({"words": words}, top_k=5, weights={"words": 2}) == hits
    assert seen[1].url.path == "/v1/indexes/docs/branches/main/hybrid"
    assert body(seen[1]) == {"searches": {"words": words}, "topK": 5, "fuse": {"weights": {"words": 2}}}
    rank = {"sum": [{"search": "words"}, {"saturate": {"of": {"attribute": "stars"}, "k": 3}}]}
    index.hybrid({"words": words}, rank=rank)
    assert body(seen[2])["rank"] == rank


def test_writes_orders_aggregates_multi_queries_exports_and_copies():
    def answer(request):
        path = request.url.path
        if path.endswith("/write"):
            return httpx.Response(200, json={"upserted": 0, "patched": 1, "deleted": 2})
        if path.endswith("/order"):
            return httpx.Response(200, json={"rows": [{"id": 1, "attributes": {}}]})
        if path.endswith("/aggregate"):
            return httpx.Response(200, json={"groups": [{"key": {}, "values": {"n": 2}}]})
        if path.endswith("/multi"):
            return httpx.Response(200, json={"results": [{"order": []}], "performance": {"server_ms": 1}})
        if path.endswith("/copy"):
            return httpx.Response(201, json={"name": body(request)["name"]})
        lines = b'{"id":1,"vectors":{},"attributes":{}}\n{"id":"two","vectors":{},"attributes":{}}\n'
        return httpx.Response(200, content=lines, headers={"content-type": "application/x-ndjson"})

    transport, seen = recorder(answer)
    index = client(transport).index("prod/a").at("dev")
    assert index.patch([{"id": 1, "attributes": {"n": None}}]) == 1
    assert index.delete_by({"tag": {"glob": "old-*"}}) == 2
    assert index.order("n", descending=True) == [{"id": 1, "attributes": {}}]
    assert index.aggregate({"n": ["count"]})[0]["values"] == {"n": 2}
    results = index.multi([{"order": {"by": "id"}}], consistency="eventual")
    assert results == [{"order": []}] and results.performance == {"server_ms": 1}
    assert [doc["id"] for doc in index.export()] == [1, "two"]
    assert index.copy("prod/b").name == "prod/b"
    assert [f"{r.method} {r.url.raw_path.decode()}" for r in seen] == [
        "POST /v1/indexes/prod%2Fa/branches/dev/write",
        "POST /v1/indexes/prod%2Fa/branches/dev/write",
        "POST /v1/indexes/prod%2Fa/branches/dev/order",
        "POST /v1/indexes/prod%2Fa/branches/dev/aggregate",
        "POST /v1/indexes/prod%2Fa/branches/dev/multi",
        "GET /v1/indexes/prod%2Fa/branches/dev/export",
        "POST /v1/indexes/prod%2Fa/copy",
    ]
    # A patch keeps None, which removes the attribute.
    assert body(seen[0]) == {"patches": [{"id": 1, "attributes": {"n": None}}]}
    assert body(seen[1]) == {"deleteBy": {"tag": {"glob": "old-*"}}}
    assert body(seen[-1]) == {"name": "prod/b", "branch": "dev"}


def test_a_write_asks_for_the_ids_it_changed_and_an_index_may_take_uuid_ids():
    answer = {"upserted": 1, "patched": 0, "deleted": 0, "upserted_ids": ["a"]}
    transport, seen = recorder(lambda r: httpx.Response(200 if r.url.path.endswith("/write") else 201, json=answer))
    sky = client(transport)
    upserts = [{"id": "a", "vectors": {"v": [0]}}]
    assert sky.index("a").write(upserts=upserts, return_affected_ids=True)["upserted_ids"] == ["a"]
    assert body(seen[0]) == {"upserts": upserts, "returnAffectedIds": True}
    sky.indexes.create("b", vectors=[{"name": "v", "dims": 1}], id_type="uuid")
    assert body(seen[1])["schema"] == {"vectors": [{"name": "v", "dims": 1}], "attributes": [], "id": "uuid"}


def test_text_vectors_and_rerank_are_sent_as_given():
    hits = [{"id": 2, "distance": 0.3, "attributes": {}, "rerank_score": 0.9}]
    transport, seen = recorder(lambda r: httpx.Response(200, json={"hits": hits}))
    index = client(transport).index("docs")
    rerank = {"model": "rerank-v3.5", "field": "body", "topN": 5}
    assert index.query("embedding", "kitten", top_k=50, rerank=rerank) == hits
    assert body(seen[0]) == {"vector": {"column": "embedding", "value": "kitten"}, "topK": 50, "rerank": rerank}
    index.search("reset", rerank=rerank)
    assert body(seen[1])["rerank"] == rerank
    index.hybrid({"words": {"query": "reset"}}, rerank=rerank)
    assert body(seen[2])["rerank"] == rerank


def test_rank_sends_the_score_and_leaves_out_what_is_not_given():
    hits = [{"id": 1, "score": 2, "attributes": {}}]
    transport, seen = recorder(lambda r: httpx.Response(200, json={"hits": hits, "billing": {"queries": 1}}))
    score = {"max_sim": {"attribute": "tokens", "vectors": [[1, 0]]}}
    ranked = client(transport).index("docs").rank(score, top_k=3)
    assert ranked == hits and ranked.billing == {"queries": 1}
    assert seen[0].url.path == "/v1/indexes/docs/branches/main/rank"
    assert body(seen[0]) == {"score": score, "topK": 3}


def test_versions_restore_fork_at_collect_and_a_parquet_export_go_to_the_right_routes():
    version = "a" * 64

    def answer(r):
        path = r.url.path
        if path.endswith("/versions"):
            return httpx.Response(200, json=[{"version": version, "time": "", "rows": 1}])
        if path.endswith("/restore"):
            return httpx.Response(200, json={"version": version, "time": "", "rows": 1})
        if path.endswith("/collect"):
            return httpx.Response(202, json={"id": "op_2", "kind": "collect"})
        if path.endswith("/export"):
            return httpx.Response(200, content=b"PAR1")
        return httpx.Response(201, json=body(r))

    transport, seen = recorder(answer)
    main = client(transport).index("products")
    assert main.versions(limit=5, after=version)[0]["rows"] == 1
    assert main.restore(version)["version"] == version
    assert main.fork("past", version).branch == "past"
    assert main.collect()["id"] == "op_2"
    assert b"".join(main.export_parquet()) == b"PAR1"
    assert [f"{r.method} {r.url.raw_path.decode()}" for r in seen] == [
        f"GET /v1/indexes/products/branches/main/versions?limit=5&after={version}",
        "POST /v1/indexes/products/branches/main/restore",
        "POST /v1/indexes/products/branches",
        "POST /v1/indexes/products/collect",
        "GET /v1/indexes/products/branches/main/export?format=parquet",
    ]
    assert body(seen[1]) == {"version": version}
    assert body(seen[2]) == {"name": "past", "from": "main", "at": version}
