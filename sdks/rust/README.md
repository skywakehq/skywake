# Skywake for Rust

An async client for Skywake: shared disks of files for AI agents, with
branches and search.

```toml
[dependencies]
skywake-client = "0.1"
```

```rust
use skywake::Skywake;

let sky = Skywake::new()?;

let app = sky.create_disk("app").search(true).await?;
app.write("notes.md", "hello").await?;
let work = app.fork("agent-1").await?;
work.write("notes.md", "changed").await?;
work.merge_into("main").await?;
let hits = app.query("greetings").limit(5).await?;
```

- **Settings.** `Skywake::new()` reads the key from `SKYWAKE_API_KEY`, or the
  profile `skywake login` saved. `Skywake::builder()` sets `key`, `url`,
  `environment`, `profile`, `retries` and `timeout`.
- **Handles.** `sky.disk(name)` makes no network call.
  `.on(branch)` is a handle on another branch; `fork` makes one.
- **Options** are builder methods, and a builder is awaited directly:
  `app.query("words").limit(5).await?`.
- **Search.** `create_disk(name).search(true)` turns search on for a disk, and
  `disk.configure().search(..)` changes it later. `grep` and `find` need no
  switch.
- **Lists** (`list_disks`, `list_keys`, `list(path).stream()`,
  `log().stream()`) are `futures::Stream`s.
- **Errors.** `Error::Api` carries `kind` (`Auth`, `Permission`, `NotFound`,
  `Conflict`, `MergeConflict { conflicts }`, `InvalidRequest`,
  `RateLimited { retry_after }`, `Server`), `status`, `code`, `message`,
  `hint`, `request_id` and `path`.
- **Retries.** Network errors and 5xx answers are retried when that is safe,
  429 always, waiting as long as the server asks.
