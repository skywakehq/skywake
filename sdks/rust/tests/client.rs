use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Bytes;
use axum::http::{Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use futures::TryStreamExt;
use serde_json::{Value, json};
use skywake::{Client, Document, Error, Options, Order, Pinned, Query, Rank, Request, Search};

/// A request the fake API saw.
#[derive(Clone, Debug)]
struct Seen {
    method: Method,
    uri: String,
    body: Value,
}

type Log = Arc<Mutex<Vec<Seen>>>;

/// A client of a fake API that answers each request with `answer(request,
/// how many came before it)`.
async fn fake(answer: impl Fn(&Seen, usize) -> Response + Send + Sync + 'static) -> (Client, Log) {
    let log = Log::default();
    let seen = log.clone();
    let answer = Arc::new(answer);
    let app = axum::Router::new().fallback(move |method: Method, uri: Uri, body: Bytes| {
        let (seen, answer) = (seen.clone(), answer.clone());
        async move {
            let body = serde_json::from_slice(&body).unwrap_or(Value::Null);
            let request = Seen {
                method,
                uri: uri.to_string(),
                body,
            };
            let before = {
                let mut seen = seen.lock().unwrap();
                seen.push(request.clone());
                seen.len() - 1
            };
            answer(&request, before)
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1/", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let options = Options {
        backoff: Duration::from_millis(1),
        ..Options::default()
    };
    (Client::with_options(&url, "sw_key", options).unwrap(), log)
}

fn json(status: StatusCode, body: Value) -> Response {
    (
        status,
        [("content-type", "application/json")],
        body.to_string(),
    )
        .into_response()
}

fn seen(log: &Log) -> Vec<Seen> {
    log.lock().unwrap().clone()
}

fn index(name: &str) -> Value {
    json!({
        "name": name, "region": "local", "schema": {"vectors": [], "attributes": []},
        "shards": 1, "encryption": null, "read_only": false, "created": "",
    })
}

#[tokio::test]
async fn an_upsert_is_sent_1000_documents_at_a_time_to_the_branch_picked() {
    let (sky, log) = fake(|seen, _| {
        let count = seen.body["documents"].as_array().unwrap().len();
        json(StatusCode::OK, json!({ "count": count, "billing": {} }))
    })
    .await;
    let docs: Vec<Document> = (0..2500)
        .map(|i| serde_json::from_value(json!({ "id": i, "vectors": { "v": [i, 0] } })).unwrap())
        .collect();
    let branch = sky.index("prod/products").at("agents/try");
    assert_eq!(branch.upsert(&docs).await.unwrap(), 2500);
    let sent: Vec<_> = (seen(&log).into_iter())
        .map(|s| (s.uri, s.body["documents"].as_array().unwrap().len()))
        .collect();
    let uri = "/v1/indexes/prod%2Fproducts/branches/agents%2Ftry/documents".to_string();
    assert_eq!(sent, [(uri.clone(), 1000), (uri.clone(), 1000), (uri, 500)]);
}

#[tokio::test]
async fn a_query_sends_only_what_is_set_and_gives_performance_and_billing() {
    let answer = json!({
        "hits": [{ "id": "a", "distance": 0.1, "attributes": {} }],
        "performance": { "server_ms": 3, "cache_temperature": "warm", "cache_hit_ratio": 0.5 },
        "billing": { "queries": 1 },
    });
    let (sky, log) = fake(move |_, _| json(StatusCode::OK, answer.clone())).await;
    let filter = json!({ "tag": { "eq": "billing" } });
    let query = Query {
        top_k: Some(5),
        filter: Some(filter.clone()),
        ..Query::new("v", [0.1, 0.2])
    };
    let hits = sky.index("products").query(&query).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, "a".into());
    assert_eq!(hits.performance.as_ref().unwrap().server_ms, 3);
    assert_eq!(hits.billing.as_ref().unwrap().queries, 1);
    let sent = &seen(&log)[0];
    assert_eq!(sent.uri, "/v1/indexes/products/branches/main/query");
    let vector = json!({ "column": "v", "value": [0.1, 0.2] });
    assert_eq!(
        sent.body,
        json!({ "vector": vector, "topK": 5, "filter": filter })
    );
}

#[tokio::test]
async fn a_429_is_tried_again_after_the_wait_asked_but_a_failed_post_is_not() {
    let (sky, log) = fake(
        |seen, before| match (seen.uri.ends_with("/order"), before) {
            (true, 0) => ([("retry-after", "0.01")], StatusCode::TOO_MANY_REQUESTS).into_response(),
            (true, _) => json(StatusCode::OK, json!({ "rows": [] })),
            (false, _) => json(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": "boom" }),
            ),
        },
    )
    .await;
    let index = sky.index("products");
    assert!(index.order(&Order::new("id")).await.unwrap().is_empty());
    assert_eq!(seen(&log).len(), 2);
    let failed = index.search(&Search::new("reset")).await.unwrap_err();
    assert_eq!(failed.status(), Some(500));
    assert_eq!(seen(&log).len(), 3, "a POST that failed may have landed");
}

#[tokio::test]
async fn a_delete_whose_retry_finds_nothing_has_deleted_it() {
    let (sky, log) = fake(|_, before| match before {
        0 => StatusCode::BAD_GATEWAY.into_response(),
        _ => json(StatusCode::NOT_FOUND, json!({ "error": "no such branch" })),
    })
    .await;
    sky.index("products")
        .at("old")
        .delete_branch()
        .await
        .unwrap();
    let methods: Vec<_> = seen(&log).into_iter().map(|s| s.method).collect();
    assert_eq!(methods, [Method::DELETE, Method::DELETE]);
}

#[tokio::test]
async fn an_error_answer_says_what_is_wrong_and_where() {
    let (sky, log) = fake(|_, _| {
        let body = json!({
            "error": "must be a number", "code": "invalid",
            "request_id": "req-1", "path": "filter.price.lt",
        });
        json(StatusCode::BAD_REQUEST, body)
    })
    .await;
    let error = sky.index("products").get(7).await.unwrap_err();
    let Error::Api {
        status,
        message,
        code,
        request_id,
        path,
    } = error
    else {
        panic!()
    };
    assert_eq!((status, message.as_str()), (400, "must be a number"));
    assert_eq!(code.as_deref(), Some("invalid"));
    assert_eq!(request_id.as_deref(), Some("req-1"));
    assert_eq!(path.as_deref(), Some("filter.price.lt"));
    assert_eq!(
        seen(&log)[0].uri,
        "/v1/indexes/products/branches/main/documents/7"
    );
}

#[tokio::test]
async fn rank_and_multi_send_their_scores_and_give_billing() {
    let (sky, log) = fake(|seen, _| {
        let hits = json!([{ "id": 1, "score": 2.0, "attributes": {} }]);
        let body = match seen.uri.ends_with("/rank") {
            true => json!({ "hits": hits, "billing": { "queries": 1 } }),
            false => json!({ "results": [{ "rank": hits }, { "order": [] }], "billing": { "queries": 2 } }),
        };
        json(StatusCode::OK, body)
    })
    .await;
    let index = sky.index("docs");
    let score = json!({ "max_sim": { "attribute": "tokens", "vectors": [[1, 0]] } });
    let rank = Rank {
        top_k: Some(3),
        ..Rank::new(score.clone())
    };
    let ranked = index.rank(&rank).await.unwrap();
    assert_eq!(
        (ranked[0].score, ranked.billing.as_ref().unwrap().queries),
        (2.0, 1)
    );

    let requests = [
        Request::Rank(Rank::new(score.clone())),
        Request::Order(Order::new("id")),
    ];
    let results = index.multi(&requests, None).await.unwrap();
    assert_eq!(results[0].rank.as_ref().unwrap()[0].id, 1.into());
    assert_eq!(results[1].order.as_deref(), Some(&[][..]));
    assert_eq!(results.billing.as_ref().unwrap().queries, 2);
    let bodies: Vec<_> = seen(&log).into_iter().map(|s| s.body).collect();
    assert_eq!(bodies[0], json!({ "score": score, "topK": 3 }));
    let multi =
        json!({ "requests": [{ "rank": { "score": score } }, { "order": { "by": "id" } }] });
    assert_eq!(bodies[1], multi);
}

#[tokio::test]
async fn an_export_streams_one_document_a_line() {
    let (sky, _) = fake(|_, _| "{\"id\":1}\n\n{\"id\":\"a\",\"vectors\":{}}".into_response()).await;
    let index = sky.index("docs");
    let docs: Vec<Document> = index.export().try_collect().await.unwrap();
    let ids: Vec<_> = docs.into_iter().map(|doc| doc.id).collect();
    assert_eq!(ids, [1.into(), "a".into()]);
}

#[tokio::test]
async fn lists_are_read_a_page_at_a_time_until_a_short_one() {
    let names: Vec<String> = (0..1001).map(|i| format!("i{i:04}")).collect();
    let all = names.clone();
    let (sky, log) = fake(move |seen, _| {
        let after = seen.uri.split("after=").nth(1).map(String::from);
        let start = after.map_or(0, |after| all.iter().position(|n| *n == after).unwrap() + 1);
        let page: Vec<_> = all[start..]
            .iter()
            .take(1000)
            .map(|name| index(name))
            .collect();
        json(StatusCode::OK, Value::Array(page))
    })
    .await;
    let indexes = sky.indexes();
    let listed: Vec<_> = indexes
        .all()
        .map_ok(|index| index.name)
        .try_collect()
        .await
        .unwrap();
    assert_eq!(listed, names);
    let uris: Vec<_> = seen(&log).into_iter().map(|s| s.uri).collect();
    assert_eq!(
        uris,
        [
            "/v1/indexes?limit=1000",
            "/v1/indexes?limit=1000&after=i0999"
        ]
    );
}

#[tokio::test]
async fn a_write_asks_for_the_ids_it_changed() {
    let (sky, log) = fake(|_, _| {
        let body = json!({ "upserted": 0, "patched": 0, "deleted": 1, "deleted_ids": ["a"] });
        json(StatusCode::OK, body)
    })
    .await;
    let write = skywake::Write {
        deletes: Some(vec!["a".into()]),
        return_affected_ids: Some(true),
        ..Default::default()
    };
    let counts = sky.index("docs").write(&write).await.unwrap();
    assert_eq!(counts.deleted_ids, Some(vec!["a".into()]));
    let body = json!({ "deletes": ["a"], "returnAffectedIds": true });
    assert_eq!(seen(&log)[0].body, body);
}

#[tokio::test]
async fn versions_restore_fork_at_collect_parquet_and_retention_go_to_their_routes() {
    let version = "a".repeat(64);
    let moment = json!({ "version": version, "time": "", "rows": 1 });
    let (sky, log) = fake(move |seen, _| {
        let path = seen.uri.split('?').next().unwrap();
        match path.rsplit('/').next().unwrap() {
            "versions" => json(StatusCode::OK, json!([moment])),
            "restore" => json(StatusCode::OK, moment.clone()),
            "collect" => json(
                StatusCode::ACCEPTED,
                json!({ "id": "op_2", "index": "products", "branch": null, "kind": "collect",
                        "status": "running", "error": null, "started": "", "finished": null }),
            ),
            "export" => "PAR1".into_response(),
            "products" => json(StatusCode::OK, index("products")),
            _ => json(StatusCode::CREATED, json!({})),
        }
    })
    .await;
    let main = sky.index("products");
    let versions = main.versions(Some(5), Some(&version)).await.unwrap();
    assert_eq!(versions[0].rows, 1);
    assert_eq!(main.restore(&version).await.unwrap().version, version);
    assert_eq!(main.fork_at("past", &version).await.unwrap().branch, "past");
    let collect = main.collect().await.unwrap();
    assert_eq!((collect.id.as_str(), collect.branch), ("op_2", None));
    let parts: Vec<Vec<u8>> = main.export_parquet().try_collect().await.unwrap();
    assert_eq!(parts.concat(), b"PAR1");
    let keep_all = skywake::UpdateIndex {
        retention_days: Some(None),
        ..Default::default()
    };
    sky.indexes().update("products", &keep_all).await.unwrap();
    let seen = seen(&log);
    let routes: Vec<String> = seen
        .iter()
        .map(|s| format!("{} {}", s.method, s.uri))
        .collect();
    assert_eq!(
        routes,
        [
            format!("GET /v1/indexes/products/branches/main/versions?limit=5&after={version}"),
            "POST /v1/indexes/products/branches/main/restore".to_string(),
            "POST /v1/indexes/products/branches".to_string(),
            "POST /v1/indexes/products/collect".to_string(),
            "GET /v1/indexes/products/branches/main/export?format=parquet".to_string(),
            "PATCH /v1/indexes/products".to_string(),
        ]
    );
    assert_eq!(seen[1].body, json!({ "version": version }));
    assert_eq!(
        seen[2].body,
        json!({ "name": "past", "from": "main", "at": version })
    );
    assert_eq!(seen[5].body, json!({ "retention_days": null }));
}

#[tokio::test]
async fn an_index_is_pinned_unpinned_and_says_where() {
    let pinning = json!({ "replicas": [{ "server": "api-1", "warm": true, "in_flight": 2 }] });
    let (sky, log) = fake(move |_, _| {
        let mut answer = index("a");
        answer["pinned"] = json!({ "replicas": 1 });
        answer["pinning"] = pinning.clone();
        json(StatusCode::OK, answer)
    })
    .await;
    let options = skywake::IndexOptions {
        pinned: Some(Pinned { replicas: 2 }),
        ..Default::default()
    };
    sky.indexes()
        .create("a", json!({}), &options)
        .await
        .unwrap();
    let pin = skywake::UpdateIndex {
        pinned: Some(Some(Pinned { replicas: 3 })),
        ..Default::default()
    };
    sky.indexes().update("a", &pin).await.unwrap();
    let unpin = skywake::UpdateIndex {
        pinned: Some(None),
        ..Default::default()
    };
    sky.indexes().update("a", &unpin).await.unwrap();
    let got = sky.indexes().get("a").await.unwrap();
    assert_eq!(got.pinned, Some(Pinned { replicas: 1 }));
    let replica = &got.pinning.unwrap().replicas[0];
    assert_eq!(
        (replica.server.as_str(), replica.warm, replica.in_flight),
        ("api-1", true, 2)
    );
    let seen = seen(&log);
    assert_eq!(seen[0].body["pinned"], json!({ "replicas": 2 }));
    assert_eq!(seen[1].body, json!({ "pinned": { "replicas": 3 } }));
    assert_eq!(seen[2].body, json!({ "pinned": null }));
}
