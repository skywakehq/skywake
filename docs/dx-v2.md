# Skywake v2: the developer experience

This is the contract for v2. Every layer (API, every SDK, the CLI, the MCP
server, the console and the docs) uses the words, verbs and defaults written
here, and nothing else. When a layer needs something this page doesn't say,
the page changes first.

## The idea in one paragraph

Skywake stores **indexes**: rows you search by meaning, keywords and filters.
You sign in with a key that already knows your company and your environment.
You get an index by its name and call a few verbs on it. An index can be
**forked** into an instant copy and **merged** back.

```ts
import { Skywake } from "skywake";

const sky = new Skywake();

const products = sky.index("products");
await products.upsert({ id: 1, text: "red running shoes", price: 89 });
await products.query("shoes for running");

const draft = await products.fork("draft");
await draft.upsert({ id: 2, text: "trail running shoes", price: 95 });
await draft.mergeInto("main");
```

## Words

| Word        | Means                                                                            | Never call it               |
| ----------- | -------------------------------------------------------------------------------- | --------------------------- |
| environment | prod, staging, dev: a separate world of indexes and keys inside one organization | a name prefix, a folder     |
| index       | a table of rows searched by meaning, keywords and filters                        | collection, namespace       |
| row         | one entry in an index: `{ id, ...fields }`                                       | document, vector, record    |
| field       | a named value on a row                                                           | attribute, column           |
| branch      | a named line of changes on an index; every one starts with `main`                | ref, version                |
| fork        | make a branch from another, instantly, at any size                               | copy, new, create branch    |
| merge       | bring a branch's changes into another                                            | —                           |
| version     | one saved change to an index, with an id                                         | —                           |
| `at`        | read the past: a version or a time                                               | a branch                    |
| query       | search: meaning, keywords, filters, sorting                                      | search, hybrid, rank, order |
| key         | an API key: one organization, one environment, one role                          | token                       |

## Rules

1. **No setup.** A key is enough. Every other setting has a default.
2. **Two levels.** The client gives you a handle (`sky.index(name)`). You call verbs on the handle. Getting a handle never
   calls the network.
3. **Branch and time are options**, not extra calls: `{ branch, at }` on any
   read or write. `fork()` returns a handle to the new branch, and
   `sky.index(name, { branch })` gets one for an existing branch.
4. **One item or many, same call.** Pass a row or an array of rows, an id or an
   array of ids. Never a wrapper object around data.
5. **`delete` removes things inside; `destroy` removes the thing itself.**
   `products.delete(1)` deletes a row; `products.destroy()` deletes the index.
   `work.destroy()` deletes the branch. Likewise `update` changes rows and
   `configure` changes settings.
6. **The least input does the obvious thing.** A string query searches by
   meaning and keywords. No branch means `main`. No id means we make one.
7. **Plain data.** Rows go in and come out flat. Filters are objects. Results
   are arrays.
8. **Errors say how to fix it.**
9. **The first write creates it.** Writing to an index that doesn't exist
   creates it. `create*` is only for choosing settings up front.

## Auth and environments

- A key belongs to one organization and one environment, and has a role:
  `read`, `write` or `admin`. It may also be narrowed to some indexes
  (`only: ["products", "docs-*"]`).
- An organization admin may make an **all-environments** key. Requests with it
  name the environment: `new Skywake({ environment: "staging" })`, header
  `Skywake-Environment`, CLI `--env`.
- Names are unique within an environment, so a name alone says which one you mean. `products` in prod and `products` in
  staging are different indexes. A name has no `/` in it.
- The console signs in as the person and shows one environment at a time.

**Where settings come from**, first match wins, in every SDK and the CLI:

| Setting     | Code          | Env var           | Credentials file     | Default                                                   |
| ----------- | ------------- | ----------------- | -------------------- | --------------------------------------------------------- |
| key         | `key`         | `SKYWAKE_API_KEY` | from `skywake login` | — (error says to run `skywake login` or set the variable) |
| URL         | `url`         | `SKYWAKE_URL`     | per profile          | `https://api.skywake.dev`                                 |
| environment | `environment` | `SKYWAKE_ENV`     | per profile          | the key's own                                             |
| profile     | `profile`     | `SKYWAKE_PROFILE` | —                    | `default`                                                 |

The credentials file is `~/.config/skywake/credentials.toml` (Windows:
`%APPDATA%\skywake\credentials.toml`), mode 600, one `[profile]` table each with
`key`, `url` and `environment`. A self-hosted server is a profile with its own
`url`.

## SDK (TypeScript shown; others below)

### Client

```ts
new Skywake(options?: { key?, url?, environment?, profile?, timeout?, retries? })

sky.index(name, { branch? })           // handle

sky.createIndex(name, { schema?, region?, embed? })   // → Index handle
sky.listIndexes()      // async iterable of { name, region, rows, created }

sky.createKey({ name, role, environment?, only?, expires? })  // → { id, key } (key shown once)
sky.listKeys()
sky.revokeKey(id)

sky.listEnvironments()
sky.createEnvironment(name, { bucket? })
sky.whoami()           // → { organization, environment, role, key }
```

### Index

```ts
const products = sky.index("products");

await products.upsert(rowOrRows)            // → { ids } ; replaces rows with the same id
await products.update(id, fields)           // change some fields of one row
await products.update(filter, fields)       // change every row matching a filter
await products.delete(idOrIds)              // or delete({ filter })
await products.get(id)                      // → row or null

await products.query(text?, {
  vector?,          // your own vector; skips embedding
  filter?,          // { price: { lt: 100 }, tags: { contains: "sale" } }
  limit?,           // default 10
  mode?,            // "auto" (default) | "meaning" | "keywords"
  sort?,            // { price: "asc" } ; with no text and no vector this lists rows in that order
  fields?,          // which fields come back; default all but vectors
  branch?, at?,
})                                          // → [{ id, score, ...fields }]
await products.count({ filter? })           // → number
await products.aggregate({ groupBy, count?, sum?, avg?, filter? })
await products.rows({ filter?, branch? })   // async iterable of every row (export)

const draft = await products.fork("draft", { at? })   // → Index handle on the new branch
await draft.mergeInto("main")               // → { version }
await draft.destroy()                       // delete the branch
await products.branches()                   // → [{ name, from, created }]
await products.versions()                   // → [{ id, created, rows }]
await products.restore(versionOrTime)       // make the branch look like it did then

await products.copy("products-v2", { environment?, branch? })   // a new index
await products.info()                       // → { name, region, schema, rows, bytes, branches }
await products.configure({ schema?, retentionDays? })   // settings
await products.destroy()
```

**Automatic behaviour**

- The first `upsert` creates the index and infers its schema from the row:
  number → `number`, boolean → `bool`, string → `text` (keyword-searchable and
  filterable), list of strings → `strings`, list of numbers → `vector` (its
  length is the dimension).
- Unless a row has a vector field, its `text` fields are embedded with the
  environment's embedding model into a managed vector the user never sees.
- A new field on a later upsert is added to the schema. A field of another type
  is an error that says which row and field.
- `query("words")` with mode `auto` runs meaning and keywords together and
  merges them. With no embedding model it runs keywords only.
- Batching, retries and rate limits are handled inside `upsert`: any size works.

**Advanced** (documented on one page, never in a quickstart):
`query({ rank })` for a ranking expression, `products.build()`,
`products.warm()`, `products.recall()`, `products.usage()`.

### Errors

Every error has `code`, `message`, `hint` and `requestId`. Classes, the same in
every SDK (named per language):

| Class             | When                                                     |
| ----------------- | -------------------------------------------------------- |
| `AuthError`       | no key, bad key, expired key                             |
| `PermissionError` | the key's role or environment doesn't allow it           |
| `NotFound`        | the name doesn't exist; `hint` suggests the closest name |
| `Conflict`        | a write lost a race, or a name is taken                  |
| `MergeConflict`   | merge couldn't finish; `.conflicts` lists the rows       |
| `InvalidRequest`  | bad input; `hint` names the field                        |
| `RateLimited`     | retried and still limited; `.retryAfter`                 |
| `ServerError`     | our fault; retried first                                 |

### Types (TypeScript)

- Rows and hits are loose objects: any field can be read without a cast.
  `id` and `score` are typed.
- A handle from `sky.createIndex(name, { schema })` has rows typed from the
  schema.
- `npx skywake types` writes types for every index in the environment;
  `sky.index("products")` is then typed by its name.

## Other SDKs

Same objects and verbs, written the way each language writes them.

|         | Python                       | Go                         | Rust              | Java            | C#                 | Ruby          |
| ------- | ---------------------------- | -------------------------- | ----------------- | --------------- | ------------------ | ------------- |
| client  | `Skywake()`                  | `skywake.New()`            | `Skywake::new()?` | `new Skywake()` | `new Skywake()`    | `Skywake.new` |
| async   | `AsyncSkywake()`             | — (ctx)                    | async             | `*Async`        | `*Async`           | —             |
| verbs   | `merge_into`, `create_index` | `MergeInto`, `CreateIndex` | `merge_into`      | `mergeInto`     | `MergeIntoAsync`   | `merge_into`  |
| options | keyword args                 | option structs             | builder           | builder         | option objects     | keyword args  |
| lists   | iterator                     | iterator                   | stream            | `Iterable`      | `IAsyncEnumerable` | `Enumerator`  |

Python returns plain dicts for rows.

## CLI

```bash
skywake login                       # paste a key or sign in through the browser
skywake whoami
skywake env [NAME]                  # show or switch the profile's environment

skywake indexes
skywake create index products [--schema schema.json]
skywake destroy products[@branch]   # asks first; --yes

skywake upsert products rows.jsonl|rows.csv|-
skywake get products 1
skywake delete products 1 2 3
skywake query products "words" [--filter "price < 100"] [--limit 10]

skywake fork products draft [--from main]
skywake merge products@draft [--into main]
skywake branches products
skywake log products[@branch]

skywake keys | keys create --role write [--only products] | keys revoke ID
skywake deploy                       # run your own: plan, cost, deploy, look after it
skywake mcp                          # the MCP server
skywake types                        # write TypeScript types
```

- `NAME@BRANCH` names a branch everywhere. No `@` means `main`.
- Every command takes `--json`, `--env` and `--profile`.
- Destructive commands ask first unless `--yes`.
- Linux (glibc and musl) and macOS (x86_64 and arm64) binaries.

## MCP server

One server, `skywake mcp` (also `npx skywake mcp`, `uvx skywake mcp`). Same
settings as above. It is written in TypeScript; the Python package's `skywake`
command starts it through `npx`, so it needs Node.

Tools: `index_query`, `index_upsert`, `index_delete`. A read-only key hides the
write tools.

## HTTP API (v2)

- Base: `https://api.skywake.dev/v2`. Auth: `Authorization: Bearer <key>`.
  Environment: from the key, or `Skywake-Environment` for an all-environments
  key.
- JSON is `snake_case`. SDKs convert option names to their language; row fields
  are passed through untouched.
- Branch and time: `?branch=` and `?at=` on every route, default `main`.
- Lists return `{ "data": [...], "next": "<cursor>" | null }` and take
  `?limit=` and `?cursor=`.
- Errors: `{ "error": { "code", "message", "hint", "request_id" } }`.
- Writes take `Idempotency-Key`.

| Route                                                   | Does                                  |
| ------------------------------------------------------- | ------------------------------------- |
| `GET /whoami`                                           | organization, environment, role, key  |
| `GET/POST /indexes`                                     | list / create                         |
| `GET/PATCH/DELETE /indexes/{index}`                     | info / settings / destroy             |
| `POST /indexes/{index}/rows`                            | upsert (creates the index if missing) |
| `PATCH /indexes/{index}/rows`                           | update by ids or filter               |
| `POST /indexes/{index}/rows/delete`                     | delete by ids or filter               |
| `GET /indexes/{index}/rows/{id}`                        | get                                   |
| `GET /indexes/{index}/rows`                             | every row, paged (export)             |
| `POST /indexes/{index}/query` · `/count` · `/aggregate` | read                                  |
| `GET/POST /indexes/{index}/branches`                    | list / fork                           |
| `DELETE /indexes/{index}/branches/{branch}`             | destroy a branch                      |
| `POST /indexes/{index}/merges`                          | merge `{ from, into }`                |
| `GET /indexes/{index}/versions` · `POST …/restore`      | history / go back                     |
| `POST /indexes/{index}/copy`                            | a new index                           |
| `GET/POST /keys` · `DELETE /keys/{id}`                  | keys                                  |
| `GET/POST /environments`                                | environments                          |

Organization, billing, SSO and audit routes keep their v1 shapes under `/v2`.
The turbopuffer-compatible API stays where it is.

## Moving from v1

- `/v1` keeps working for one release after v2 ships, then returns 410 with a
  pointer to this page.
- Data: `prod/products` becomes `products` in environment `prod`. A name with
  no `/` goes to environment `default`. If a name would collide, the console
  and `skywake whoami` list it and the old full name stays reachable on `/v1`.
- Keys: a key for `prod/*` becomes a `prod` key. A key for `prod/app` becomes a
  `prod` key with `only: ["app"]`. A key for `*` becomes an all-environments
  key.

## The scenario list

Every SDK and the CLI run these against a real local server in CI. A layer
isn't done until all pass.

1. Start with only `SKYWAKE_API_KEY` set: `whoami` shows the environment.
2. Upsert one row to a new index with no schema; `query("…")` finds it.
3. Upsert 10,000 rows in one call; `count()` is 10,000.
4. Query with a filter, a limit and `mode: "keywords"`.
5. `update(id, …)`, `get(id)` shows the change; `delete(id)`, `get(id)` is null.
6. Fork the index, change the fork, query both, merge; main has the change.
7. `query` with `at` returns the old rows after a change.
8. A staging key gets `PermissionError` on a prod index; a read key gets
   `PermissionError` on write.
9. A wrong name gets `NotFound` with a suggestion.
10. `destroy` a branch, then the index; lists are empty.

## Use cases page

The docs get one page with a short, runnable example for each, built only from
the verbs above:

- **Product search:** upsert products, `query` with filters.
- **Try a change before it's live:** fork an index, re-embed or re-rank, compare,
  merge.
- **Reproducible evals:** run each eval on a fork at a fixed `at`.
- **Bring your own vectors:** upsert rows with a vector field, `query({ vector })`.
