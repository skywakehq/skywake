# Skywake for Rust

An async client for Skywake: disks of files and search indexes, both with
branches.

```toml
[dependencies]
skywake-client = "0.1"
```

```rust
use serde_json::json;
use skywake::Skywake;

let sky = Skywake::new()?;

let products = sky.index("products");
products.upsert(json!({ "id": 1, "text": "red running shoes", "price": 89 })).await?;
let hits = products.query("shoes for running").limit(5).await?;

let app = sky.disk("app");
app.write("notes.md", "hello").await?;
let work = app.fork("agent-1").await?;
work.write("notes.md", "changed").await?;
work.merge_into("main").await?;
```

- **Settings.** `Skywake::new()` reads the key from `SKYWAKE_API_KEY`, or the
  profile `skywake login` saved. `Skywake::builder()` sets `key`, `url`,
  `environment`, `profile`, `retries` and `timeout`.
- **Handles.** `sky.disk(name)` and `sky.index(name)` make no network call.
  `.on(branch)` is a handle on another branch; `fork` makes one.
- **Options** are builder methods, and a builder is awaited directly:
  `products.query("words").limit(5).await?`.
- **Rows and hits** are `serde_json::Map`. Filters are `serde_json::Value`.
- **Lists** (`list_disks`, `list_indexes`, `list_keys`, `rows().stream()`,
  `log().stream()`) are `futures::Stream`s.
- **Errors.** `Error::Api` carries `kind` (`Auth`, `Permission`, `NotFound`,
  `Conflict`, `MergeConflict { conflicts }`, `InvalidRequest`,
  `RateLimited { retry_after }`, `Server`), `status`, `code`, `message`,
  `hint`, `request_id` and `path`.
- **Retries.** Network errors and 5xx answers are retried when that is safe,
  429 always, waiting as long as the server asks.
