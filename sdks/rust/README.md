# Skywake for Rust

An async client for Skywake search indexes.

```toml
[dependencies]
skywake-client = "0.1"
```

```rust
use serde_json::json;
use skywake::{Client, Document, Query, Rank};

let sky = Client::new("https://api.skywake.dev", "sw_...")?;
let products = sky.index("products");

let doc: Document = serde_json::from_value(json!({
    "id": 1,
    "vectors": { "embedding": [0.1, 0.2] },
    "attributes": { "title": "Blue mug", "price": 12 },
}))?;
products.upsert(&[doc]).await?;

let query = Query {
    top_k: Some(5),
    filter: Some(json!({ "price": { "lt": 20 } })),
    ..Query::new("embedding", [0.1, 0.2])
};
for hit in products.query(&query).await?.iter() {
    println!("{} {}", hit.id, hit.distance);
}
```

- **Branches.** `sky.index(name)` is `main`; `.at(branch)` is another.
  `fork`, `merge` and `delete_branch` work on them. Nothing is copied.
- **Reads.** `query`, `search` (BM25), `hybrid`, `order`, `rank` (sparse and
  late-interaction scores), `aggregate` and `multi` (several on one
  snapshot). Each returns its items with `performance` and `billing`.
- **Writes.** `upsert`, `delete` and `patch` send 1000 to a request; `write`
  makes one change of upserts, patches, deletes and conditions.
- **Filters, scores and attribute values** are `serde_json::Value`, as the
  API documents them. Fields left `None` are not sent, so the server uses
  its defaults.
- **Lists.** `indexes().list`, `branches` and `documents` read one page;
  `all`, `all_branches`, `all_documents` and `export` are streams.
- **Retries.** Network errors and 5xx answers are tried again when that is
  safe, 429 always, waiting as long as the server asks (at most 60 s).
  Set `Options { retries, backoff, timeout }` with `Client::with_options`.
- **Errors.** `Error::Api` has the `status`, `code`, `request_id` and, for
  an invalid request, the JSON `path` of the field that is wrong.
