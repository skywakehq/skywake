use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use axum::body::Bytes;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use futures::TryStreamExt;
use serde_json::{Value, json};
use skywake::{ErrorKind, Skywake};

#[derive(Clone, Debug)]
struct Seen {
    method: Method,
    path: String,
    query: HashMap<String, String>,
    headers: HeaderMap,
    body: Bytes,
}

impl Seen {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap()
    }
}

type Log = Arc<Mutex<Vec<Seen>>>;

struct Api {
    url: String,
    log: Log,
}

impl Api {
    fn sky(&self) -> skywake::Builder {
        Skywake::builder()
            .url(&self.url)
            .key("k")
            .backoff(Duration::from_millis(1))
    }

    fn seen(&self) -> Vec<Seen> {
        self.log.lock().unwrap().clone()
    }
}

async fn fake(answer: impl Fn(&Seen, usize) -> Response + Send + Sync + 'static) -> Api {
    let log = Log::default();
    let kept = log.clone();
    let answer = Arc::new(answer);
    let app = axum::Router::new()
        .fallback(
            move |method: Method, uri: Uri, headers: HeaderMap, body: Bytes| {
                let (kept, answer) = (kept.clone(), answer.clone());
                async move {
                    let query = uri
                        .query()
                        .map(|query| {
                            query
                                .split('&')
                                .filter_map(|pair| pair.split_once('='))
                                .map(|(name, value)| (name.to_string(), value.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();
                    let seen = Seen {
                        method,
                        path: uri.path().to_string(),
                        query,
                        headers,
                        body,
                    };
                    let count = {
                        let mut log = kept.lock().unwrap();
                        log.push(seen.clone());
                        log.len()
                    };
                    answer(&seen, count)
                }
            },
        )
        .layer(axum::extract::DefaultBodyLimit::disable());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Api { url, log }
}

fn reply(status: u16, body: Value) -> Response {
    let status = StatusCode::from_u16(status).unwrap();
    (
        status,
        [("content-type", "application/json")],
        body.to_string(),
    )
        .into_response()
}

fn ok(body: Value) -> Response {
    reply(200, body)
}

fn failure(status: u16, code: &str, extra: Value) -> Response {
    let mut error = json!({ "code": code, "message": "nope", "hint": null, "request_id": "req-1" });
    if let (Some(error), Some(extra)) = (error.as_object_mut(), extra.as_object()) {
        error.extend(extra.clone());
    }
    reply(status, json!({ "error": error }))
}

#[tokio::test]
async fn requests_go_to_v2_with_the_key_and_the_environment() {
    let api =
        fake(|_, _| ok(json!({ "organization": "acme", "environment": "prod", "role": "admin" })))
            .await;
    let me = api
        .sky()
        .environment("prod")
        .build()
        .unwrap()
        .whoami()
        .await
        .unwrap();
    assert_eq!(me.environment.as_deref(), Some("prod"));
    let seen = &api.seen()[0];
    assert_eq!(seen.path, "/v2/whoami");
    assert_eq!(seen.headers["authorization"], "Bearer k");
    assert_eq!(seen.headers["skywake-environment"], "prod");
}

#[tokio::test]
async fn each_status_becomes_its_own_error_with_the_hint_in_the_message() {
    let api = fake(|_, count| match count {
        1 => failure(401, "unauthorized", json!({})),
        2 => failure(403, "forbidden", json!({})),
        3 => failure(
            404,
            "not_found",
            json!({ "hint": "did you mean `products`?" }),
        ),
        _ => failure(500, "internal", json!({})),
    })
    .await;
    let sky = api.sky().retries(0).build().unwrap();
    assert_eq!(
        sky.whoami().await.unwrap_err().kind(),
        Some(&ErrorKind::Auth)
    );
    assert_eq!(
        sky.whoami().await.unwrap_err().kind(),
        Some(&ErrorKind::Permission)
    );
    let error = sky.disk("prodcts").info().await.unwrap_err();
    let api_error = error.api().unwrap();
    assert_eq!(api_error.kind, ErrorKind::NotFound);
    assert_eq!(api_error.hint.as_deref(), Some("did you mean `products`?"));
    assert!(error.to_string().contains("did you mean `products`?"));
    assert_eq!(api_error.request_id.as_deref(), Some("req-1"));
    assert_eq!(
        sky.whoami().await.unwrap_err().kind(),
        Some(&ErrorKind::Server)
    );
}

#[tokio::test]
async fn a_429_is_retried_as_the_server_asks_then_reported_with_retry_after() {
    let api = fake(|_, _| {
        let mut response = failure(429, "rate_limited", json!({}));
        response
            .headers_mut()
            .insert("retry-after", "1".parse().unwrap());
        response
    })
    .await;
    let error = api
        .sky()
        .retries(1)
        .build()
        .unwrap()
        .whoami()
        .await
        .unwrap_err();
    assert_eq!(
        error.kind(),
        Some(&ErrorKind::RateLimited {
            retry_after: Some(Duration::from_secs(1))
        })
    );
    assert_eq!(api.seen().len(), 2);
}

#[tokio::test]
async fn a_merge_that_cant_finish_is_a_merge_conflict_listing_what_conflicts() {
    let api = fake(|_, _| failure(409, "conflict", json!({ "conflicts": ["README.md"] }))).await;
    let sky = api.sky().build().unwrap();
    let work = sky.disk("app").on("agent-1");
    let error = work.merge_into("main").await.unwrap_err();
    assert_eq!(
        error.kind(),
        Some(&ErrorKind::MergeConflict {
            conflicts: vec!["README.md".into()]
        })
    );
    assert_eq!(
        api.seen()[0].json(),
        json!({ "from": "agent-1", "into": "main" })
    );
}

#[tokio::test]
async fn lists_follow_next_until_the_last_page() {
    let api = fake(
        |seen, _| match seen.query.get("cursor").map(String::as_str) {
            Some("b") => ok(json!({ "data": [{ "name": "c" }], "next": null })),
            _ => ok(json!({ "data": [{ "name": "a" }, { "name": "b" }], "next": "b" })),
        },
    )
    .await;
    let disks: Vec<_> = api
        .sky()
        .build()
        .unwrap()
        .list_disks()
        .try_collect()
        .await
        .unwrap();
    let names: Vec<_> = disks.iter().map(|disk| disk.name.as_str()).collect();
    assert_eq!(names, ["a", "b", "c"]);
}

#[tokio::test]
async fn files_are_read_and_written_by_path_each_part_of_it_encoded() {
    let api = fake(|seen, _| {
        if seen.method == Method::GET {
            (StatusCode::OK, "hello").into_response()
        } else {
            ok(json!({ "commit": "c1", "changed": true }))
        }
    })
    .await;
    let sky = api.sky().build().unwrap();
    let app = sky.disk("app");
    assert_eq!(app.read("/docs/a b.md").at("c0").await.unwrap(), "hello");
    assert_eq!(app.read("x").bytes().await.unwrap(), b"hello");
    app.write_files([
        ("a.md", skywake::Content::from("one")),
        ("b.bin", vec![0xff, 0x00].into()),
    ])
    .message("two")
    .await
    .unwrap();
    let seen = api.seen();
    assert_eq!(seen[0].path, "/v2/disks/app/files/docs/a%20b.md");
    assert_eq!(seen[0].query["at"], "c0");
    assert_eq!(
        seen[2].json(),
        json!({
            "message": "two",
            "branch": "main",
            "changes": [{ "path": "a.md", "text": "one" }, { "path": "b.bin", "base64": "/wA=" }],
        })
    );
}

#[tokio::test]
async fn a_large_file_goes_up_in_parts_before_its_commit() {
    let api = fake(|seen, _| {
        if seen.path.ends_with("/uploads") {
            let size = seen.body.len();
            reply(201, json!({ "part": format!("p{size}"), "size": size }))
        } else {
            ok(json!({ "commit": "c1", "changed": true }))
        }
    })
    .await;
    let sky = api.sky().build().unwrap();
    sky.disk("app")
        .write("big.bin", vec![0u8; 20 * 1024 * 1024])
        .await
        .unwrap();
    let seen = api.seen();
    let parts: Vec<_> = seen
        .iter()
        .filter(|seen| seen.path.ends_with("/uploads"))
        .map(|seen| seen.body.len())
        .collect();
    assert_eq!(parts, [16 * 1024 * 1024, 4 * 1024 * 1024]);
    assert_eq!(
        seen.last().unwrap().json()["changes"],
        json!([{ "path": "big.bin", "parts": [format!("p{}", 16 * 1024 * 1024), format!("p{}", 4 * 1024 * 1024)] }])
    );
}

#[tokio::test]
async fn a_fork_is_a_handle_on_the_new_branch_and_destroy_removes_just_the_branch() {
    let api = fake(|seen, _| {
        if seen.method == Method::DELETE {
            StatusCode::NO_CONTENT.into_response()
        } else {
            reply(201, json!({ "name": "agent-1" }))
        }
    })
    .await;
    let sky = api.sky().build().unwrap();
    let work = sky.disk("app").fork("agent-1").at("c3").await.unwrap();
    assert_eq!(work.branch(), "agent-1");
    work.destroy().await.unwrap();
    let seen = api.seen();
    assert_eq!(
        seen[0].json(),
        json!({ "name": "agent-1", "from": "main", "at": "c3" })
    );
    assert_eq!(
        (seen[1].method.clone(), seen[1].path.as_str()),
        (Method::DELETE, "/v2/disks/app/branches/agent-1")
    );
}

#[tokio::test]
async fn restore_to_a_time_picks_the_newest_commit_at_or_before_it() {
    let api = fake(|seen, _| {
        if seen.method == Method::GET {
            ok(json!({
                "data": [
                    { "id": "c3", "message": "", "created": "2026-01-03T00:00:00Z", "merged": null },
                    { "id": "c2", "message": "", "created": "2026-01-02T00:00:00Z", "merged": null },
                ],
                "next": null,
            }))
        } else {
            ok(json!({ "commit": "c4", "changed": true }))
        }
    })
    .await;
    let sky = api.sky().build().unwrap();
    let noon = SystemTime::UNIX_EPOCH + Duration::from_secs(1_767_355_200);
    sky.disk("app").restore(noon).await.unwrap();
    assert_eq!(
        api.seen()[1].json(),
        json!({ "to": "c2", "branch": "main" })
    );
}

fn disk_tree(seen: &Seen) -> Response {
    if seen.path.starts_with("/v2/disks/app/files/") {
        return (StatusCode::OK, "from the disk").into_response();
    }
    let listing = match seen.query.get("path").map(String::as_str).unwrap_or("") {
        "" => json!([
            { "path": "a", "kind": "folder" },
            { "path": "link", "kind": "symlink", "target": "a/x" },
            { "path": "top", "kind": "file", "size": 13 }
        ]),
        "a" => json!([{ "path": "a/x", "kind": "file", "size": 13 }]),
        _ => json!([]),
    };
    ok(json!({ "data": listing, "next": null }))
}

#[cfg(unix)]
#[tokio::test]
async fn a_download_never_writes_through_a_symlink() {
    let api = fake(|seen, _| disk_tree(seen)).await;
    let sky = api.sky().build().unwrap();
    let base = std::env::temp_dir().join(format!("skywake-links-{}", std::process::id()));
    let (into, outside) = (base.join("into"), base.join("outside"));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&into).unwrap();
    std::fs::create_dir_all(&outside).unwrap();

    // A clean download: files, then the link.
    sky.disk("app").download(&into).at("c1").await.unwrap();
    assert_eq!(
        std::fs::read_to_string(into.join("a/x")).unwrap(),
        "from the disk"
    );
    assert_eq!(
        std::fs::read_link(into.join("link")).unwrap(),
        Path::new("a/x")
    );

    // A folder an earlier download left as a link is refused, not followed.
    std::fs::remove_dir_all(into.join("a")).unwrap();
    std::os::unix::fs::symlink(&outside, into.join("a")).unwrap();
    let refused = sky.disk("app").download(&into).at("c1").await;
    assert!(refused.is_err());
    assert!(!outside.join("x").exists());

    // A file where a link pointing out was is replaced, not written through.
    std::fs::remove_file(into.join("a")).unwrap();
    std::fs::write(outside.join("kept"), "mine").unwrap();
    std::fs::remove_file(into.join("top")).unwrap();
    std::os::unix::fs::symlink(outside.join("kept"), into.join("top")).unwrap();
    sky.disk("app").download(&into).at("c1").await.unwrap();
    assert_eq!(
        std::fs::read_to_string(outside.join("kept")).unwrap(),
        "mine"
    );
    assert_eq!(
        std::fs::read_to_string(into.join("top")).unwrap(),
        "from the disk"
    );
    std::fs::remove_dir_all(&base).unwrap();
}
