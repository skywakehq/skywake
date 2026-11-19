import asyncio
import json

import httpx
import pytest
from skywake import (
    AsyncSkywake,
    AuthError,
    MergeConflict,
    NotFound,
    PermissionError,
    RateLimited,
    ServerError,
    Skywake,
)


def fake(reply):
    seen = []

    def handle(request):
        seen.append(request)
        answer = reply(request, len(seen))
        if isinstance(answer, Exception):
            raise answer
        return answer

    return seen, httpx.MockTransport(handle)


def failure(status, code, headers=None, **extra):
    body = {"error": {"code": code, "message": "nope", "hint": None, "request_id": "req-1", **extra}}
    return httpx.Response(status, json=body, headers=headers)


def ok(body=None, status=200):
    return httpx.Response(status, json=body)


def client(transport, **options):
    return Skywake(url="http://api", key="sw_key", transport=transport, backoff=0.001, **options)


def body(request):
    return json.loads(request.content)


def test_requests_go_to_v2_with_the_key_and_the_environment():
    seen, transport = fake(lambda *_: ok({"environment": "prod"}))
    assert client(transport, environment="prod").whoami() == {"environment": "prod"}
    assert str(seen[0].url) == "http://api/v2/whoami"
    assert seen[0].headers["authorization"] == "Bearer sw_key"
    assert seen[0].headers["skywake-environment"] == "prod"


def test_each_status_becomes_its_own_error_with_the_hint_in_the_message():
    replies = [failure(401, "unauthorized"), failure(403, "forbidden"), failure(500, "internal")]
    seen, transport = fake(lambda _, n: replies[n - 1])
    sky = client(transport, retries=0)
    with pytest.raises(AuthError):
        sky.whoami()
    with pytest.raises(PermissionError):
        sky.whoami()
    with pytest.raises(ServerError):
        sky.whoami()

    seen, transport = fake(lambda *_: failure(404, "not_found", hint="did you mean `products`?"))
    with pytest.raises(NotFound) as raised:
        client(transport).index("prodcts").info()
    assert raised.value.hint == "did you mean `products`?"
    assert "did you mean `products`?" in str(raised.value)
    assert raised.value.request_id == "req-1"


def test_idempotent_requests_are_retried_after_a_5xx_or_a_network_error():
    replies = [failure(503, "unavailable"), httpx.ConnectError("down"), ok({"organization": "o"})]
    seen, transport = fake(lambda _, n: replies[n - 1])
    assert client(transport).whoami() == {"organization": "o"}
    assert len(seen) == 3


def test_a_post_is_not_retried_after_a_5xx():
    seen, transport = fake(lambda *_: failure(503, "unavailable"))
    with pytest.raises(ServerError):
        client(transport).create_environment("prod")
    assert len(seen) == 1


def test_a_429_is_retried_as_asked_then_reported_with_retry_after(monkeypatch):
    waits = []
    monkeypatch.setattr("skywake._transport.time.sleep", waits.append)
    seen, transport = fake(lambda *_: failure(429, "rate_limited", {"retry-after": "2"}))
    with pytest.raises(RateLimited) as raised:
        client(transport, retries=1).create_environment("prod")
    assert raised.value.retry_after == 2.0
    assert waits == [2.0]
    assert seen[1].content == seen[0].content


def test_a_merge_that_cannot_finish_is_a_merge_conflict():
    seen, transport = fake(lambda *_: failure(409, "conflict", conflicts=["cup"]))
    with pytest.raises(MergeConflict) as raised:
        client(transport).index("products", branch="draft").merge_into()
    assert raised.value.conflicts == ["cup"]
    assert body(seen[0]) == {"from": "draft", "into": "main"}


def test_lists_follow_next_until_the_last_page():
    def reply(request, _):
        if request.url.params.get("cursor") == "b":
            return ok({"data": [{"name": "c"}], "next": None})
        return ok({"data": [{"name": "a"}, {"name": "b"}], "next": "b"})

    seen, transport = fake(reply)
    assert [index["name"] for index in client(transport).list_indexes()] == ["a", "b", "c"]


def test_upsert_takes_any_number_of_rows_in_batches():
    def reply(request, _):
        rows = body(request)
        return ok({"ids": [row["id"] for row in rows], "count": len(rows)})

    seen, transport = fake(reply)
    rows = [{"id": i, "text": f"row {i}"} for i in range(25_000)]
    done = client(transport).index("products").upsert(rows)
    assert done["count"] == 25_000
    assert [len(body(request)) for request in seen] == [10_000, 10_000, 5_000]
    assert seen[0].url.params["branch"] == "main"


def test_update_and_delete_take_an_id_ids_or_a_filter():
    seen, transport = fake(lambda *_: ok({"count": 1}))
    products = client(transport).index("products")
    products.update(7, {"stock": 3})
    products.update({"tag": {"eq": "sale"}}, {"stock": 0})
    products.delete([1, 2])
    products.delete({"filter": {"stock": {"eq": 0}}})
    assert [(r.method, r.url.path, body(r)) for r in seen] == [
        ("PATCH", "/v2/indexes/products/rows", {"id": 7, "fields": {"stock": 3}}),
        ("PATCH", "/v2/indexes/products/rows", {"filter": {"tag": {"eq": "sale"}}, "fields": {"stock": 0}}),
        ("POST", "/v2/indexes/products/rows/delete", {"ids": [1, 2]}),
        ("POST", "/v2/indexes/products/rows/delete", {"filter": {"stock": {"eq": 0}}}),
    ]


def test_get_gives_none_for_a_missing_row_but_raises_for_a_missing_index():
    def reply(request, _):
        if "/rows/" in request.url.path:
            return failure(404, "not_found", path="id")
        return failure(404, "not_found", hint="did you mean `products`?")

    seen, transport = fake(reply)
    sky = client(transport)
    assert sky.index("products").get("a b") is None
    assert seen[0].url.raw_path.decode().startswith("/v2/indexes/products/rows/a%20b")
    with pytest.raises(NotFound):
        sky.index("prodcts").info()


def test_query_takes_text_first_and_options_by_keyword():
    seen, transport = fake(lambda *_: ok({"data": [{"id": 1, "score": 0.9, "title": "mug"}], "next": None}))
    products = client(transport).index("products", branch="draft")
    assert products.query("coffee", limit=3, mode="keywords")[0]["title"] == "mug"
    assert body(seen[0]) == {"text": "coffee", "limit": 3, "mode": "keywords", "branch": "draft"}


def test_a_fork_is_a_handle_and_destroy_removes_just_the_branch():
    def reply(request, _):
        return httpx.Response(204) if request.method == "DELETE" else ok({"name": "agent-1"}, 201)

    seen, transport = fake(reply)
    work = client(transport).index("products").fork("agent-1", at="2026-01-02T00:00:00Z")
    assert work.branch == "agent-1"
    work.destroy()
    assert body(seen[0]) == {"name": "agent-1", "from": "main", "at": "2026-01-02T00:00:00Z"}
    assert (seen[1].method, seen[1].url.path) == ("DELETE", "/v2/indexes/products/branches/agent-1")


def test_the_async_client_has_the_same_handles():
    def reply(request, _):
        if request.url.path.endswith("/rows/delete"):
            return ok({"count": 2})
        return ok({"data": [{"name": "a"}], "next": None})

    seen, transport = fake(reply)

    async def main():
        async with AsyncSkywake(url="http://api", key="sw_key", transport=transport) as sky:
            assert await sky.index("products").delete([1, 2]) == 2
            return [index["name"] async for index in sky.list_indexes()]

    assert asyncio.run(main()) == ["a"]
