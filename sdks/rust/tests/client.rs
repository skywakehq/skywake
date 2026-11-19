use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use axum::body::Bytes;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use futures::TryStreamExt;
use serde_json::{Value, json};
use skywake::{ErrorKind, Mode, Order, Skywake};

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
    let error = sky.index("prodcts").info().await.unwrap_err();
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
    let work = sky.index("docs").on("agent-1");
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
    let indexes: Vec<_> = api
        .sky()
        .build()
        .unwrap()
        .list_indexes()
        .try_collect()
        .await
        .unwrap();
    let names: Vec<_> = indexes.iter().map(|index| index.name.as_str()).collect();
    assert_eq!(names, ["a", "b", "c"]);
}

#[tokio::test]
async fn upsert_takes_any_number_of_rows_and_sends_them_in_batches() {
    let api = fake(|seen, _| {
        let rows = seen.json();
        let ids: Vec<_> = rows
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["id"].clone())
            .collect();
        ok(json!({ "count": ids.len(), "ids": ids }))
    })
    .await;
    let rows: Vec<Value> = (0..25_000)
        .map(|id| json!({ "id": id, "text": format!("row {id}") }))
        .collect();
    let sky = api.sky().build().unwrap();
    let done = sky.index("products").upsert(rows).await.unwrap();
    assert_eq!(done.count, 25_000);
    assert_eq!(done.ids.len(), 25_000);
    let sizes: Vec<_> = api
        .seen()
        .iter()
        .map(|seen| seen.json().as_array().unwrap().len())
        .collect();
    assert_eq!(sizes, [10_000, 10_000, 5_000]);
    assert_eq!(api.seen()[0].query["branch"], "main");
}

#[tokio::test]
async fn update_and_delete_take_an_id_ids_or_a_filter() {
    let api = fake(|_, _| ok(json!({ "count": 1 }))).await;
    let sky = api.sky().build().unwrap();
    let products = sky.index("products");
    products.update(7, json!({ "stock": 3 })).await.unwrap();
    products
        .update(json!({ "tag": { "eq": "sale" } }), json!({ "stock": 0 }))
        .await
        .unwrap();
    products.delete(vec![1, 2]).await.unwrap();
    products
        .delete(json!({ "filter": { "stock": { "eq": 0 } } }))
        .await
        .unwrap();
    let seen: Vec<_> = api
        .seen()
        .iter()
        .map(|seen| (seen.method.to_string(), seen.path.clone(), seen.json()))
        .collect();
    let rows = "/v2/indexes/products/rows".to_string();
    let delete = "/v2/indexes/products/rows/delete".to_string();
    assert_eq!(
        seen,
        [
            (
                "PATCH".into(),
                rows.clone(),
                json!({ "id": 7, "fields": { "stock": 3 } })
            ),
            (
                "PATCH".into(),
                rows,
                json!({ "filter": { "tag": { "eq": "sale" } }, "fields": { "stock": 0 } })
            ),
            ("POST".into(), delete.clone(), json!({ "ids": [1, 2] })),
            (
                "POST".into(),
                delete,
                json!({ "filter": { "stock": { "eq": 0 } } })
            ),
        ]
    );
}

#[tokio::test]
async fn get_gives_none_for_a_missing_row_but_fails_for_a_missing_index() {
    let api = fake(|seen, _| {
        if seen.path.contains("/rows/") {
            failure(404, "not_found", json!({ "path": "id" }))
        } else {
            failure(
                404,
                "not_found",
                json!({ "hint": "did you mean `products`?" }),
            )
        }
    })
    .await;
    let sky = api.sky().build().unwrap();
    assert_eq!(sky.index("products").get("a b").await.unwrap(), None);
    assert_eq!(api.seen()[0].path, "/v2/indexes/products/rows/a%20b");
    let error = sky.index("prodcts").info().await.unwrap_err();
    assert_eq!(error.kind(), Some(&ErrorKind::NotFound));
}

#[tokio::test]
async fn query_takes_text_first_and_options_on_their_own() {
    let api = fake(|_, _| {
        ok(json!({ "data": [{ "id": 1, "score": 0.9, "title": "mug" }], "next": null }))
    })
    .await;
    let sky = api.sky().build().unwrap();
    let products = sky.index("products").on("draft");
    let hits = products
        .query("coffee")
        .limit(3)
        .mode(Mode::Keywords)
        .await
        .unwrap();
    assert_eq!(hits[0]["title"], "mug");
    products
        .query(None)
        .filter(json!({ "price": { "lt": 10 } }))
        .sort("price", Order::Asc)
        .await
        .unwrap();
    let seen = api.seen();
    assert_eq!(
        seen[0].json(),
        json!({ "text": "coffee", "limit": 3, "mode": "keywords", "branch": "draft" })
    );
    assert_eq!(
        seen[1].json(),
        json!({ "filter": { "price": { "lt": 10 } }, "sort": { "price": "asc" }, "branch": "draft" })
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
    let work = sky.index("docs").fork("agent-1").at("c3").await.unwrap();
    assert_eq!(work.branch(), "agent-1");
    work.destroy().await.unwrap();
    let seen = api.seen();
    assert_eq!(
        seen[0].json(),
        json!({ "name": "agent-1", "from": "main", "at": "c3" })
    );
    assert_eq!(
        (seen[1].method.clone(), seen[1].path.as_str()),
        (Method::DELETE, "/v2/indexes/docs/branches/agent-1")
    );
}

#[tokio::test]
async fn restore_to_a_time_sends_it_as_an_instant_on_the_branch() {
    let api =
        fake(|_, _| ok(json!({ "id": "v2", "created": "2026-01-02T12:00:00Z", "rows": 3 }))).await;
    let sky = api.sky().build().unwrap();
    let noon = SystemTime::UNIX_EPOCH + Duration::from_secs(1_767_355_200);
    sky.index("docs").restore(noon).await.unwrap();
    let seen = api.seen();
    assert_eq!(seen[0].path, "/v2/indexes/docs/restore");
    assert_eq!(
        seen[0].json(),
        json!({ "to": "2026-01-02T12:00:00.000Z", "branch": "main" })
    );
}
