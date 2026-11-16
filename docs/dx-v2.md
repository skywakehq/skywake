# Skywake v2: the developer experience

This is the contract for v2. Every layer (API, every SDK, the CLI, the MCP
server, the console and the docs) uses the words, verbs and defaults written
here, and nothing else. When a layer needs something this page doesn't say,
the page changes first.

## The idea in one paragraph

Skywake stores two things. A **disk** holds files. An **index** holds rows you
search. You sign in with a key that already knows your company and your
environment. You get a disk or an index by its name and call a few verbs on it.
Both can be **forked** into an instant copy and **merged** back.

```ts
import { Skywake } from "skywake";

const sky = new Skywake();

const products = sky.index("products");
await products.upsert({ id: 1, text: "red running shoes", price: 89 });
await products.query("shoes for running");

const app = sky.disk("app");
await app.write("notes.md", "hello");
const work = await app.fork("agent-1");
await work.write("notes.md", "changed");
await work.mergeInto("main");
```

## Words

| Word        | Means                                                                                   | Never call it                        |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------------------ |
| environment | prod, staging, dev: a separate world of disks, indexes and keys inside one organization | a name prefix, a folder              |
| disk        | a set of files with branches and history                                                | namespace, store, filesystem, bucket |
| index       | a table of rows searched by meaning, keywords and filters                               | collection, namespace                |
| row         | one entry in an index: `{ id, ...fields }`                                              | document, vector, record             |
| field       | a named value on a row                                                                  | attribute, column                    |
| branch      | a named line of changes on a disk or an index; every one starts with `main`             | ref, version                         |
| fork        | make a branch from another, instantly, at any size                                      | copy, new, create branch             |
| merge       | bring a branch's changes into another                                                   | —                                    |
| commit      | one saved change to a disk, with an id                                                  | —                                    |
| version     | one saved change to an index, with an id                                                | —                                    |
| `at`        | read the past: a commit, a version, or a time                                           | a branch                             |
| query       | search: meaning, keywords, filters, sorting                                             | search, hybrid, rank, order          |
| grep / find | match file contents / file paths on a disk                                              | search                               |
| key         | an API key: one organization, one environment, one role                                 | token                                |

## Rules

1. **No setup.** A key is enough. Every other setting has a default.
2. **Two levels.** The client gives you a handle (`sky.disk(name)`,
   `sky.index(name)`). You call verbs on the handle. Getting a handle never
   calls the network.
3. **Branch and time are options**, not extra calls: `{ branch, at }` on any
   read or write. `fork()` returns a handle to the new branch, and
   `sky.disk(name, { branch })` gets one for an existing branch.
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
9. **The first write creates it.** Writing to a disk or index that doesn't exist
   creates it. `create*` is only for choosing settings up front.

## Auth and environments

- A key belongs to one organization and one environment, and has a role:
  `read`, `write` or `admin`. It may also be narrowed to some disks and indexes
  (`only: ["app", "docs-*"]`).
- An organization admin may make an **all-environments** key. Requests with it
  name the environment: `new Skywake({ environment: "staging" })`, header
  `Skywake-Environment`, CLI `--env`.
- Names are unique within an environment, across disks and indexes together,
  so a name alone says which one you mean. `products` in prod and `products` in
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

sky.disk(name, { branch? })            // handle
sky.index(name, { branch? })           // handle

sky.createDisk(name, { region?, search? })            // → Disk handle
sky.createIndex(name, { schema?, region?, embed? })   // → Index handle
sky.listDisks()        // async iterable of { name, region, created }
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

### Disk

```ts
const app = sky.disk("app");

await app.read(path, { branch?, at?, as? })    // → string (as: "bytes" | "stream")
await app.write(path, content, { message?, branch? })     // one file; every write is a commit
await app.write({ [path]: content }, { message?, branch? }) // many files, one commit
await app.delete(pathOrPaths, { message? })
await app.move(from, to, { message? })
await app.list(path?, { recursive?, branch?, at? })        // → [{ path, kind, size, modified }]
await app.exists(path)

await app.grep(pattern, { path?, glob?, ignoreCase?, limit? })   // → [{ path, line, text }]
await app.find(glob, { path?, kind? })                            // → [{ path, kind }]
await app.query(text, { limit?, path?, branch? })                 // → [{ path, score, snippet }]

const work = await app.fork("agent-1", { at? })   // → Disk handle on the new branch
await work.mergeInto("main", { message?, dryRun?, prefer? })     // → { commit } ; conflict → MergeConflict
await work.destroy()
await app.branches()

await app.log({ path?, limit? })           // async iterable of commits
await app.diff(otherBranchOrCommit)        // → [{ path, change }]
await app.revert(commit)
await app.restore(commitOrTime)            // make the branch look like it did then

await app.download(localDir, { branch? })  // whole branch to a folder
await app.upload(localDir, { message? })   // a folder as one commit
await app.info()
await app.configure({ search? })
await app.destroy()
```

**Automatic behaviour**

- The first write creates the disk.
- `search` is on by default when the environment has an embedding model:
  `app.query` then works with nothing else to do. Turning it off keeps `grep`
  and `find`.
- Large files upload in parts on their own.

**Advanced:** sessions and claims (`app.session()`, `app.claim(path)`) for many
agents writing one branch; `app.credentials()` for direct S3 access.

### Agents

```ts
import { bashTool } from "skywake/ai";
import { shell } from "skywake/bash";

tools: {
  bash: bashTool(work);
} // AI SDK tool on a disk handle
const sh = shell(work);
await sh.run("rg TODO src");
```

### Errors

Every error has `code`, `message`, `hint` and `requestId`. Classes, the same in
every SDK (named per language):

| Class             | When                                                        |
| ----------------- | ----------------------------------------------------------- |
| `AuthError`       | no key, bad key, expired key                                |
| `PermissionError` | the key's role or environment doesn't allow it              |
| `NotFound`        | the name doesn't exist; `hint` suggests the closest name    |
| `Conflict`        | a write lost a race, or a name is taken                     |
| `MergeConflict`   | merge couldn't finish; `.conflicts` lists the files or rows |
| `InvalidRequest`  | bad input; `hint` names the field                           |
| `RateLimited`     | retried and still limited; `.retryAfter`                    |
| `ServerError`     | our fault; retried first                                    |

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

Every SDK has disks and indexes. Python returns plain dicts for rows.

## CLI

```bash
skywake login                       # paste a key or sign in through the browser
skywake whoami
skywake env [NAME]                  # show or switch the profile's environment

skywake disks                       # list
skywake indexes
skywake create disk app [--region eu]
skywake create index products [--schema schema.json]
skywake destroy app[@branch]        # asks first; --yes

skywake list app[@branch][/path]   # alias: ls
skywake read app/notes.md          # alias: cat
skywake write app/notes.md [FILE|-] [-m MESSAGE]
skywake delete app/notes.md        # alias: rm
skywake grep PATTERN app[/path]
skywake find GLOB app
skywake upload ./dir app[@branch] [-m MESSAGE]
skywake download app[@branch] ./dir
skywake mount app[@branch] ./dir    # Linux; FUSE

skywake upsert products rows.jsonl|rows.csv|-
skywake get products 1
skywake delete products 1 2 3
skywake query products|app "words" [--filter "price < 100"] [--limit 10]

skywake fork app agent-1 [--from main]
skywake merge app@agent-1 [--into main]
skywake branches app
skywake log app[@branch] [--path P]
skywake diff app@agent-1 [main]

skywake keys | keys create --role write [--only app] | keys revoke ID
skywake mcp                          # the MCP server
skywake types                        # write TypeScript types
```

- `NAME@BRANCH` names a branch everywhere. No `@` means `main`.
- Every command takes `--json`, `--env` and `--profile`.
- Destructive commands ask first unless `--yes`.
- Linux (glibc and musl) and macOS (x86_64 and arm64) binaries.
- `--local [DIR]` (or a profile with `store = "s3://…"`) runs disk commands
  against a bucket with no server, as `skywake new`/`commit` do today.

## MCP server

One server, `skywake mcp` (also `npx skywake mcp`, `uvx skywake mcp`). Same
settings as above, plus `SKYWAKE_DISK` and `SKYWAKE_BRANCH` to fix where file
tools work.

Tools: `read`, `write`, `delete`, `list`, `grep`, `find`, `query`, `bash`,
`fork`, `merge`, `log`, `diff`, `index_query`, `index_upsert`, `index_delete`.
A read-only key hides the write tools. Without `SKYWAKE_BRANCH` the server forks
a branch for the session instead of writing to `main`.

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

| Route                                                   | Does                                    |
| ------------------------------------------------------- | --------------------------------------- |
| `GET /whoami`                                           | organization, environment, role, key    |
| `GET/POST /disks`                                       | list / create                           |
| `GET/PATCH/DELETE /disks/{disk}`                        | info / settings / destroy               |
| `GET /disks/{disk}/files?path=`                         | list a folder                           |
| `GET/PUT/DELETE /disks/{disk}/files/{path}`             | read / write one file / delete one file |
| `POST /disks/{disk}/commits`                            | many changes as one commit              |
| `GET /disks/{disk}/commits`                             | log                                     |
| `GET /disks/{disk}/diff?against=`                       | diff                                    |
| `POST /disks/{disk}/grep` · `/find` · `/query`          | contents / paths / meaning              |
| `POST /disks/{disk}/revert` · `/restore`                | undo a commit / go back                 |
| `POST /disks/{disk}/uploads`                            | a large file part                       |
| `GET/POST /disks/{disk}/branches`                       | list / fork                             |
| `DELETE /disks/{disk}/branches/{branch}`                | destroy a branch                        |
| `POST /disks/{disk}/merges`                             | merge `{ from, into }`                  |
| `GET/POST /indexes`                                     | list / create                           |
| `GET/PATCH/DELETE /indexes/{index}`                     | info / settings / destroy               |
| `POST /indexes/{index}/rows`                            | upsert (creates the index if missing)   |
| `PATCH /indexes/{index}/rows`                           | update by ids or filter                 |
| `POST /indexes/{index}/rows/delete`                     | delete by ids or filter                 |
| `GET /indexes/{index}/rows/{id}`                        | get                                     |
| `GET /indexes/{index}/rows`                             | every row, paged (export)               |
| `POST /indexes/{index}/query` · `/count` · `/aggregate` | read                                    |
| `GET/POST /indexes/{index}/branches`                    | list / fork                             |
| `DELETE /indexes/{index}/branches/{branch}`             | destroy a branch                        |
| `POST /indexes/{index}/merges`                          | merge `{ from, into }`                  |
| `GET /indexes/{index}/versions` · `POST …/restore`      | history / go back                       |
| `POST /indexes/{index}/copy`                            | a new index                             |
| `GET/POST /keys` · `DELETE /keys/{id}`                  | keys                                    |
| `GET/POST /environments`                                | environments                            |

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
- Linked indexes stop being their own resource: they become a disk's `search`
  setting, and leave index lists.

## The scenario list

Every SDK and the CLI run these against a real local server in CI. A layer
isn't done until all pass.

1. Start with only `SKYWAKE_API_KEY` set: `whoami` shows the environment.
2. Upsert one row to a new index with no schema; `query("…")` finds it.
3. Upsert 10,000 rows in one call; `count()` is 10,000.
4. Query with a filter, a limit and `mode: "keywords"`.
5. `update(id, …)`, `get(id)` shows the change; `delete(id)`, `get(id)` is null.
6. Fork the index, change the fork, query both, merge; main has the change.
7. Write a file to a new disk; read it back; `list` shows it.
8. Write many files in one commit; `log` shows one commit.
9. Fork the disk, write on both sides to the same file, merge: `MergeConflict`
   lists it.
10. `grep`, `find` and `query` on a disk find a file.
11. `read` with `at` returns the old content after a change.
12. A staging key gets `PermissionError` on a prod index; a read key gets
    `PermissionError` on write.
13. A wrong name gets `NotFound` with a suggestion.
14. `destroy` a branch, then the index and the disk; lists are empty.

## Use cases page

The docs get one page with a short, runnable example for each, built only from
the verbs above:

- **Give each AI agent its own copy of a codebase:** fork, bash tool, merge.
- **Chat with your files:** write files to a disk, `app.query`.
- **Product search:** upsert products, `query` with filters.
- **Try a change before it's live:** fork an index, re-embed or re-rank, compare,
  merge.
- **Reproducible evals:** run each eval on a fork at a fixed `at`.
- **Bring your own vectors:** upsert rows with a vector field, `query({ vector })`.
