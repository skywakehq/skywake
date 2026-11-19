# Skywake for Rust

An async client for Skywake, the open-source search index: vector and
full-text search over rows kept in your own bucket, with branches.

```toml
[dependencies]
skywake-client = "0.1"
```

```rust
use serde_json::json;
use skywake::Skywake;

let sky = Skywake::new()?;

let products = sky.create_index("products").await?;
products.upsert(json!({ "id": 1, "text": "red running shoes", "price": 89 })).await?;
let hits = products.query("shoes for running").limit(5).await?;

let draft = products.fork("draft").await?;
draft.upsert(json!({ "id": 2, "text": "blue trail shoes", "price": 120 })).await?;
draft.merge_into("main").await?;
```

- **Settings.** `Skywake::new()` reads the key from `SKYWAKE_API_KEY`, or the
  profile `skywake login` saved. `Skywake::builder()` sets `key`, `url`,
  `environment`, `profile`, `retries` and `timeout`.
- **Handles.** `sky.index(name)` makes no network call. `.on(branch)` is a
  handle on another branch; `fork` makes one.
- **Options** are builder methods, and a builder is awaited directly:
  `products.query("words").limit(5).await?`.
- **Rows and hits** are `serde_json::Map`. Filters are `serde_json::Value`.
- **Lists** (`list_indexes`, `list_keys`, `rows().stream()`) are
  `futures::Stream`s.
- **Errors.** `Error::Api` carries `kind` (`Auth`, `Permission`, `NotFound`,
  `Conflict`, `MergeConflict { conflicts }`, `InvalidRequest`,
  `RateLimited { retry_after }`, `Server`), `status`, `code`, `message`,
  `hint`, `request_id` and `path`.
- **Retries.** Network errors and 5xx answers are retried when that is safe,
  429 always, waiting as long as the server asks.
