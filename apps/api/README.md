# @skywake/api

The Skywake API: the routes in `@skywake/contract`, served by Hono on Node (22.18 or later), over the engine
(`@skywake/engine`) and Postgres. Everything lives under `/v1`; the spec is at `/v1/openapi.json`.

```bash
node src/main.ts
```

## Settings

Read from the environment, and from the `.env` at the repository's root when it
exists; a variable already set wins. The schema is `apiEnv` in `packages/env`.

| Variable                                               |                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SKYWAKE_API_DATABASE`                                 | Postgres URL. Needed.                                                                                                                                                                                                            |
| `SKYWAKE_API_DATABASE_POOL`                            | Postgres connections per process. `16`.                                                                                                                                                                                          |
| `SKYWAKE_STORE`                                        | The default region's store: a folder or `s3://bucket/folder`. Needed.                                                                                                                                                            |
| `SKYWAKE_API_REGION`                                   | The default region's name. `local`.                                                                                                                                                                                              |
| `SKYWAKE_API_REGIONS`                                  | More regions, `name=store` split by commas. Each filesystem and index picks one.                                                                                                                                                 |
| `SKYWAKE_API_ADMIN_TOKEN`                              | Needed to create organizations. At least 16 characters.                                                                                                                                                                          |
| `SKYWAKE_API_JWKS_URL`, `_JWT_ISSUER`, `_JWT_AUDIENCE` | Accept console sign-in tokens. With the URL, the issuer and audience are needed too.                                                                                                                                             |
| `SKYWAKE_API_LISTEN`                                   | `0.0.0.0:8080`.                                                                                                                                                                                                                  |
| `SKYWAKE_API_METRICS_LISTEN`                           | Where to serve Prometheus metrics, at `/metrics`, such as `127.0.0.1:9464`. Off by default.                                                                                                                                      |
| `SKYWAKE_API_CORS_ORIGINS`                             | Browser origins allowed, split by commas. None by default.                                                                                                                                                                       |
| `SKYWAKE_API_RATE_LIMIT`                               | Requests per minute per client address, and per key or user, shared by all processes. `1200`; `0` off.                                                                                                                           |
| `SKYWAKE_API_BODY_LIMIT_MB`                            | `64`.                                                                                                                                                                                                                            |
| `SKYWAKE_API_TRUST_PROXY`                              | How many proxies in front add to `X-Forwarded-For`. `0`; `true` means `1`.                                                                                                                                                       |
| `SKYWAKE_API_AUDIT_DAYS`                               | How many days the audit log keeps events. `365`; `0` keeps them forever.                                                                                                                                                         |
| `SKYWAKE_API_STS_ROLE_ARN`                             | An IAM role to mint credentials for one namespace with. Without it, `/credentials` answers 501.                                                                                                                                  |
| `SKYWAKE_API_STS_ENDPOINT`                             | The STS endpoint of an S3-compatible store, such as MinIO or RustFS.                                                                                                                                                             |
| `SKYWAKE_API_STS_SECONDS`                              | How long minted credentials last, 900 to 3600. `900`.                                                                                                                                                                            |
| `SKYWAKE_API_EMBED_URL`                                | An OpenAI-compatible API, such as `https://api.openai.com/v1` or Ollama's `http://localhost:11434/v1`. The API calls `{url}/embeddings` to embed text given for a vector column with `embed`. Off by default.                    |
| `SKYWAKE_API_EMBED_KEY`                                | Its key, sent as a bearer token. Not needed by a local model server.                                                                                                                                                             |
| `SKYWAKE_API_RERANK_URL`                               | A Cohere-style rerank API, such as `https://api.cohere.com/v2` or `https://api.jina.ai/v1`. The API calls `{url}/rerank` for queries with `rerank`. Off by default.                                                              |
| `SKYWAKE_API_RERANK_KEY`                               | Its key, sent as a bearer token.                                                                                                                                                                                                 |
| `SKYWAKE_INDEX_CACHE_DIR`                              | A local folder, ideally on NVMe, that search indexes keep the blobs they read in, so warm queries skip object storage. Shared by every index of the process. Indexes with their own encryption key never use it. Off by default. |
| `SKYWAKE_INDEX_CACHE_GB`                               | How much that folder may hold. `10`.                                                                                                                                                                                             |
| `SKYWAKE_CACHE_NODES`                                  | Cache nodes (`skywake-cache`) that read the default region's store, as for skywaked: `http://10.0.0.5:7070,...`. Index blobs the folder above lacks are asked from them before object storage.                                   |
| `SKYWAKE_CACHE_TOKEN`                                  | The cache nodes' token.                                                                                                                                                                                                          |
| `SKYWAKE_HEADS`                                        | `tier`: the cache nodes own the default region's branch heads and serve its whole bucket. Credentials then come with a pass for them and may not write `refs/`. Default `bucket`.                                                |
| `SKYWAKE_API_PRICES`                                   | Invoice prices that differ from the defaults, in dollars per unit: `queries=0.000004,writes=0.000002,deletes=0.000002,embeddings=0.00001,reranks=0.00002,storage=0.33,pinned=0.001`; storage per GB-month, pinned per GB-hour.   |
| `SKYWAKE_API_PEER_URL`                                 | How the other API servers reach this one, to send it the queries of the pinned indexes it holds. `http://127.0.0.1:{port}` by default; the Helm chart uses the pod IP.                                                           |
| `SKYWAKE_API_PEER_TOKEN`                               | A secret all API servers share, 16 characters or more. Without it, a pinned index's queries are answered by whichever server gets them.                                                                                          |

The engine finds the store's keys, region and endpoint in the usual
`AWS_*` variables; the credentials route reads `AWS_REGION` and
`AWS_ENDPOINT` from them too. Credentials already handed out keep working
until they expire (900 seconds by default), so revoking a key or protecting a
branch reaches them only then.

Protecting a branch answers once the commits, deletes and merges into it
that were allowed before have ended, so none of them lands after. A running
write leaves a mark in Postgres that lapses 30 seconds after its process
dies; no database connection is held while it runs. If writes are still
running after two minutes, protecting answers 503 and the branch stays
protected.

## Running it

- `/health` answers while the process runs; `/ready` also checks Postgres
  and every region's store, at most once every 5 seconds. Neither counts
  toward the rate limit.
- Each request is logged as one JSON line on stdout: its id (also in the
  `X-Request-Id` header and in every error body), method, route, status,
  seconds, and the organization and key or user. Keys and file contents are
  never logged.
- Every error body is `{ "error", "code", "request_id" }`; `code` is for programs.
- Merges into one branch take turns through a lease row in Postgres, so
  no database connection is held while a merge works on the store.

## Layout

```
src/
  main.ts          start the server
  app.ts           safety layers, then the features, under /v1
  config.ts        settings
  http/            the request context, errors, rate limit, request helpers
  auth/            keys, console tokens, sign-in, roles, and access.ts:
                   who may reach a namespace, the one place the rule lives
  db/              the client, the tables (schema.ts) and running migrations
  engine/          regions with an engine per namespace, and merge turns
  features/        one folder per part of the contract, named the same:
    <feature>/
      routes.ts    the route handlers
      queries.ts   its Postgres queries
      rules.ts     its platform rules, if any
```

## Changing the tables

`src/db/schema.ts` is the one description of the tables. After changing it,
run `pnpm db:generate`: it writes the difference as a new SQL file in
`migrations/`. Read it, then commit it with the change. The server runs
migrations that have not run yet when it starts, one server at a time.
Never edit a migration that has been committed; add another.

## Adding to the API

1. Describe the route in `packages/contract` and list it in `routes`.
2. Implement it with `api.openapi(route, handler)` in `features/<feature>/routes.ts`, and list a
   new feature in `app.ts`. The handler's inputs and outputs
   are typed from the contract, so it can't drift.
3. Reach namespaces only through `readable` or `changeable` in `http/request.ts`, so access stays in
   one place.
4. Add a test. `e2e/conformance` holds the tests every server must pass.

## Running many

The API keeps no state of its own, so you can run as many copies as you
like behind a load balancer. Set `SKYWAKE_API_TRUST_PROXY` on each to the
number of proxies in front of it (`1` for one load balancer), and
keep copies × `SKYWAKE_API_DATABASE_POOL` under Postgres's `max_connections`
(or put PgBouncer in front). Many agents writing to the same branch at once
get `409` and retry; agents on their own forks never wait for each other.
