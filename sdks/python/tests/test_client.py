import json

import httpx
import pytest
from skywake import Skywake, SkywakeError


def fake(answers):
    """A transport that gives `answers` in turn and records each request."""
    seen = []

    def handle(request):
        seen.append(request)
        answer = answers[min(len(seen), len(answers)) - 1]
        if isinstance(answer, Exception):
            raise answer
        return answer

    return httpx.MockTransport(handle), seen


def failure(status, code, **headers):
    body = {"error": "nope", "code": code, "request_id": "req-1"}
    return httpx.Response(status, json=body, headers=headers)


def client(transport, **options):
    return Skywake("http://api", "sw_key", transport=transport, backoff=0.001, **options)


def test_idempotent_requests_are_retried_after_a_5xx():
    transport, seen = fake([failure(503, "unavailable"), httpx.Response(200, json=[])])
    assert client(transport).namespaces() == []
    assert len(seen) == 2


def test_network_errors_are_retried_for_idempotent_requests():
    transport, seen = fake([httpx.ConnectError("down"), httpx.Response(200, json=[])])
    assert client(transport).namespaces() == []
    assert len(seen) == 2


def test_a_post_is_not_retried_after_a_5xx_or_a_network_error():
    transport, seen = fake([failure(503, "unavailable")])
    with pytest.raises(SkywakeError):
        client(transport).create_environment("prod")
    assert len(seen) == 1

    transport, seen = fake([httpx.ReadTimeout("slow")])
    with pytest.raises(httpx.ReadTimeout):
        client(transport).create_environment("prod")
    assert len(seen) == 1


def test_any_request_is_retried_after_a_429(monkeypatch):
    waits = []
    monkeypatch.setattr("skywake._http.time.sleep", waits.append)
    made = httpx.Response(201, json={"name": "prod"})
    transport, seen = fake([failure(429, "rate_limited", **{"retry-after": "2"}), made])
    sky = Skywake("http://api", "sw_key", transport=transport)
    assert sky.create_environment("prod") == {"name": "prod"}
    assert len(seen) == 2
    assert seen[1].content == seen[0].content
    assert waits == [2.0]


def test_errors_carry_the_code_and_request_id_after_the_last_retry():
    transport, seen = fake([failure(500, "internal")])
    with pytest.raises(SkywakeError) as raised:
        client(transport, retries=2).namespaces()
    assert len(seen) == 3
    assert raised.value.status == 500
    assert raised.value.code == "internal"
    assert raised.value.request_id == "req-1"


def test_a_4xx_is_not_retried():
    transport, seen = fake([failure(404, "not_found")])
    with pytest.raises(SkywakeError) as raised:
        client(transport).namespace("x").branches()
    assert raised.value.code == "not_found"
    assert len(seen) == 1


def test_credentials_are_asked_for_one_namespace():
    answer = {"store": "s3://b/o/n", "access": "read"}
    transport, seen = fake([httpx.Response(200, json=answer)])
    assert client(transport).namespace("prod/app").credentials("read") == answer
    assert seen[0].url.raw_path == b"/v1/namespaces/prod%2Fapp/credentials"
    assert seen[0].content == b'{"access":"read"}'


def test_a_wait_the_server_asks_for_is_kept_up_to_its_longest(monkeypatch):
    waits = []
    monkeypatch.setattr("skywake._http.time.sleep", waits.append)
    transport, _ = fake([failure(429, "rate_limited", **{"retry-after": "60"}), httpx.Response(200, json=[])])
    assert client(transport).namespaces() == []
    assert waits == [60.0]


def test_a_delete_retried_after_a_failure_that_may_have_landed_takes_404_as_done():
    transport, seen = fake([failure(503, "unavailable"), failure(404, "not_found")])
    client(transport).namespace("x").branch("gone").delete()
    assert len(seen) == 2

    transport, seen = fake([httpx.ConnectError("down"), failure(404, "not_found")])
    client(transport).namespace("x").branch("gone").delete()

    # A 404 on the first try is still an error.
    transport, seen = fake([failure(404, "not_found")])
    with pytest.raises(SkywakeError):
        client(transport).namespace("x").branch("gone").delete()


def test_a_file_can_be_read_as_a_stream():
    transport, seen = fake([httpx.Response(200, content=iter([b"hello ", b"world"]))])
    branch = client(transport).namespace("x").branch("main")
    assert b"".join(branch.read_stream("a.txt", offset=1)) == b"hello world"
    assert seen[0].url.params["path"] == "a.txt"
    assert seen[0].url.params["offset"] == "1"

    transport, _ = fake([failure(404, "not_found")])
    with pytest.raises(SkywakeError) as raised:
        client(transport).namespace("x").branch("main").read_stream("a.txt")
    assert raised.value.code == "not_found"


def test_a_list_takes_a_page_and_iter_follows_after_until_a_short_page():
    names = [f"b{i:04}" for i in range(1001)]

    def handle(request):
        seen.append(request.url.params)
        after = request.url.params.get("after")
        start = names.index(after) + 1 if after else 0
        limit = int(request.url.params.get("limit", 1000))
        return httpx.Response(200, json=[{"name": name} for name in names[start : start + limit]])

    seen = []
    ns = client(httpx.MockTransport(handle)).namespace("prod/app")
    assert ns.branches(limit=2, after="b0005") == [{"name": "b0006"}, {"name": "b0007"}]
    assert str(seen[0]) == "limit=2&after=b0005"

    assert [branch["name"] for branch in ns.iter_branches()] == names
    assert [str(params) for params in seen[1:]] == ["limit=1000", "limit=1000&after=b0999"]


def test_folder_entries_are_paged_by_name():
    pages = [[{"name": f"a{i:04}"} for i in range(1000)], [{"name": "b"}]]
    transport, seen = fake([httpx.Response(200, json={"entries": entries}) for entries in pages])
    main = client(transport).namespace("app").branch("main")
    assert len(list(main.iter_entries("src"))) == 1001
    assert [str(request.url.params) for request in seen] == [
        "path=src&limit=1000",
        "path=src&limit=1000&after=a0999",
    ]


def test_revert_reset_resolve_and_diff_against_the_base():
    conflict = {"error": "nope", "code": "conflict", "request_id": "r", "conflicts": ["a.txt"]}
    transport, seen = fake(
        [
            httpx.Response(201, json={"head": "h1", "changed": True}),
            httpx.Response(409, json=conflict),
            httpx.Response(200, json={"head": "h0", "changed": False}),
            httpx.Response(409, json={"head": None, **conflict, "conflicts": ["b.txt"]}),
            httpx.Response(200, json=[]),
        ]
    )
    ns = client(transport).namespace("app")
    main = ns.branch("main")
    assert main.revert("c1", message="undo") == {"head": "h1", "changed": True}
    with pytest.raises(SkywakeError) as raised:
        main.revert("bad")
    assert raised.value.status == 409
    assert raised.value.conflicts == ["a.txt"]
    assert main.reset("c0") == {"head": "h0", "changed": False}

    resolve = [{"path": "a.txt", "take": "ours"}]
    merged = ns.branch("try").merge_into("main", resolve=resolve)
    assert merged.conflicts == ["b.txt"]
    main.diff("dev", against="base")

    assert [(request.url.path, request.content) for request in seen[:4]] == [
        ("/v1/namespaces/app/branches/main/revert", b'{"commit":"c1","message":"undo"}'),
        ("/v1/namespaces/app/branches/main/revert", b'{"commit":"bad"}'),
        ("/v1/namespaces/app/branches/main/reset", b'{"to":"c0"}'),
        ("/v1/namespaces/app/merges", b'{"from":"try","into":"main","resolve":[{"path":"a.txt","take":"ours"}]}'),
    ]
    assert str(seen[4].url.params) == "from=dev&against=base"


def test_a_dry_run_merge_saves_nothing_and_lists_conflicts():
    transport, seen = fake([httpx.Response(200, json={"head": None, "conflicts": ["a.txt"]})])
    merged = client(transport).namespace("app").branch("try").merge_into("main", dry_run=True)
    assert (merged.head, merged.conflicts) == (None, ["a.txt"])
    assert seen[0].content == b'{"from":"try","into":"main","dry_run":true}'


def test_a_fork_can_start_at_an_older_commit():
    transport, seen = fake([httpx.Response(201, json={"name": "old"})])
    client(transport).namespace("app").branch("main").fork("old", at="c0ffee")
    assert json.loads(seen[0].content) == {"name": "old", "from": "main", "at": "c0ffee"}
