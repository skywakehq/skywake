# How Skywake works

The design in detail: the storage format, the API and running it yourself. The
[README](../README.md) is the short version, and [engine-v2.md](engine-v2.md) covers the query
engine.

## Storage

Everything an index holds lives in one folder of a bucket, and almost all of it is immutable.

```
<bucket>/<prefix>/ix/ix_…/
  refs/<branch>        the branch head: its current version
  objects/, chunks/    versions, segments and their tables, named by hash
  blobs/<blake3>       built data: vector clusters, text parts, row maps
  skywake.json         {"kind": "index"}
```

Everything but the heads is named by its BLAKE3 hash and checked against that hash on every read.

- **Writes.** Each upsert or delete is stored as a segment and is durable by the time the call
  returns. Rows written since the last build are searched exactly, so a query sees every write
  that finished before it.
- **Builds.** A background build groups rows into IVF clusters of about 2,000 rows per vector
  column, and writes BM25 parts for text fields, so a search reads a few clusters and postings
  instead of every row.
- **Branches.** The only mutable state: one object per branch, holding its head version. Moving
  a branch replaces it with a write that succeeds only if nobody replaced it since it was read
  (`If-Match`), so when two writers race from the same head, exactly one wins and the other
  retries. That conditional write is all the coordination there is; it needs nothing but S3.
  Forking a branch writes one new head that points at an existing version, so it copies no
  data. Every write makes a new version, which can be read, forked from or restored.
- **Each folder says its kind.** `skywake.json` is written when the index is made. Garbage
  collection reads it first and refuses a folder that is not an index.
- **Deletes are queued.** Deleting an index removes its row and queues its folder in one SQL
  statement, and a worker on every server deletes queued folders until they are empty. Nothing
  is left in the bucket by a crash between the two.
- **A customer's bucket.** An environment may keep its data in a bucket its owner brings, reached
  through a role Skywake assumes (with an external ID) or through keys sealed with AES-256-GCM.
  Its indexes have the region `bucket:<org>/<environment>`, and the bucket can't change while
  the environment holds data.

Any S3 that supports conditional writes (`If-None-Match` and `If-Match`) works: AWS S3,
Cloudflare R2, RustFS and others. Skywake checks this once before its first conditional write
and refuses a store that ignores them.

## Reads and caches

An API server reads through an in-memory cache keyed by content hash, then a local disk cache of
whole blobs (`SKYWAKE_INDEX_CACHE_DIR`), then, when they run, the shared cache nodes, then the
bucket. Every blob is named by its hash, so a cached copy is never stale.

With many API servers, run `skywake-cache` on a few machines with fast local disk and give every
API server the list in `SKYWAKE_CACHE_NODES`. Nodes and servers share a secret,
`SKYWAKE_CACHE_TOKEN`, sent as a bearer token. Each blob then leaves the bucket once for the whole
fleet. A node that is down or slow costs one short wait, then is skipped and the bucket read
instead, so a node can make a read faster but never wrong.

A server that reads an index often takes a short read lease on it. While it holds the lease,
every write on any server tells it about the change before the write returns, so a warm read
makes no request to Postgres or the bucket. Leases need `SKYWAKE_API_PEER_TOKEN`.

## The API and clients

Clients use the HTTP API (`/v2`) through an SDK, the CLI or the MCP server (`skywake mcp`). The
API is described by one OpenAPI spec (`GET /v2/openapi.json`), written from the same contract the
server is built on. The SDKs retry rate-limited and failed requests when that is safe, time out,
and raise typed errors (`NotFound`, `Conflict` and so on) that carry the API's `code`, `hint` and
`request_id`. Lists come in pages (`?limit=` and `?cursor=`), and the SDKs follow them for you.

```python
from skywake import Skywake

products = Skywake().index("products")
products.upsert([{"id": 1, "text": "red running shoes", "price": 89}])
print(products.query("shoes for running", filter={"price": {"lt": 100}}))
```

- An **organization** holds **environments** such as `prod` and `staging`, and each environment
  holds **indexes** by name, such as `products`. Each index is its own folder of the bucket.
- **API keys** belong to one organization and one environment, as `read`, `write` or `admin`,
  may be narrowed to some indexes (`only: ["products"]`), and may expire. An organization admin
  may make a key for every environment; requests with it send `Skywake-Environment`. Keys look
  like `sw_...` and end in a checksum, so secret scanners can spot a leaked one. The console's
  sign-in tokens (JWTs) work too. Every call goes into a tamper-evident audit log.
- **Merge** brings a branch's writes back into the branch it forked from.

## Running it

`skywake deploy` plans, prices and runs Skywake on one machine, a server you reach over SSH,
Kubernetes, or AWS, GCP and Azure. To run the pieces yourself:

- One machine: [docker/README.md](../docker/README.md).
- Kubernetes in your own cloud, with the API scaling with the load:
  [deploy/helm/skywake/README.md](../deploy/helm/skywake/README.md).

For the API on its own, run `node apps/api/src/main.ts` (Node 22.18 or later, after
`pnpm install` and `pnpm --filter @skywake/engine build`) with a Postgres database
(`SKYWAKE_API_DATABASE`), the store (`SKYWAKE_STORE`) and an admin token
(`SKYWAKE_API_ADMIN_TOKEN`). `POST /v1/orgs` with the admin token creates an organization and
returns its first admin key; everything else uses keys. To accept the console's sign-in tokens,
set `SKYWAKE_API_JWKS_URL`, `SKYWAKE_API_JWT_ISSUER` and `SKYWAKE_API_JWT_AUDIENCE`. Every setting
lives in one `.env` at the root (`scripts/setup.sh` makes it; `.env.example` lists them all), and
[apps/api/README.md](../apps/api/README.md) explains the API's.
`docker compose -f docker/dev/compose.yaml up -d` starts Postgres and S3 locally.

```bash
pnpm build                   # every package, through Turborepo
pnpm typecheck               # also: pnpm lint, pnpm test
pnpm dev                     # the web console on localhost:3100, with the API and zero-cache
pnpm dev:all                 # everything on localhost:3000: the site, /docs and /dashboard
pnpm e2e                     # conformance tests, against a running API (SKYWAKE_API, SKYWAKE_ADMIN)
scripts/format.sh            # rustfmt, ruff and Prettier; --check to only check
scripts/openapi.sh           # after changing a route: rebuild the spec and TypeScript types
scripts/bench.sh index --quick   # a 5,000-row index benchmark on the local store
```

The console (`apps/console`) is a Next.js app. People sign in with Better Auth (passwords,
passkeys, two-factor) and work in organizations. A sync engine, [Zero](https://zero.rocicorp.dev),
copies the organization's data from the API's Postgres into each browser and keeps it current.
The console shows one environment at a time and opens on a table of its indexes. Postgres needs
`wal_level=logical` (the bundled one has it).

[benchmarks/README.md](../benchmarks/README.md) explains the benchmarks, and
[benchmarks.md](benchmarks.md) lists the published numbers and how each was made.
