# Self-hosting Skywake

`compose.yaml`, at the repository's root, runs all of Skywake on one machine:

| Service    | What it is                                                        | Port |
| ---------- | ----------------------------------------------------------------- | ---- |
| `api`      | The API that agents, the SDKs and the console talk to             | 8080 |
| `console`  | The web console                                                   | 3100 |
| `zero`     | zero-cache, which keeps the console up to date as agents work     | 4848 |
| `postgres` | The API's and the console's database                              |      |
| `s3`       | [RustFS](https://rustfs.com), an S3 server for the branches' data |      |

The docs are optional and need none of these: `docker compose --profile
docs up -d` adds them at http://localhost:3200 (or `docker compose
--profile docs up -d docs` for the docs alone).

## Start

At the repository's root:

```bash
scripts/start.sh
```

It installs Docker if it is missing (asking first), runs `scripts/setup.sh` to make `.env`
with every secret filled in, builds the images one at a time, starts everything and waits
until the API and the console answer. `scripts/start.sh stop` stops it and keeps the data.
By hand, the same is `scripts/setup.sh && docker compose up -d`.

`.env` is the only settings file, for self-hosting and development alike;
`.env.example` lists every setting, and `packages/env` holds the checks
each service runs on them at start.

The first start builds the images, which takes 10 to 20 minutes and about 6 GB of memory. Then open
http://localhost:3100, sign up, and make an organization. (On a new
database the console logs one Better Auth "schema mismatch" just before it
makes its tables; that is expected.)

In the console, make an environment and a filesystem, then an API key on
the API keys page.

Agents use the API at http://localhost:8080 with that key. A key with the
`write` role can fork, write and merge; making environments and
filesystems needs `admin`.

## Database roles

Each service connects to Postgres as its own role, made by
`postgres/roles.sh` when the database is first made: the API owns its
tables, the console owns only Better Auth's and may read the tables Zero syncs (its changes go to the API over HTTP), and zero-cache may select only
the tables it copies to browsers. `scripts/setup.sh` sets their passwords (`API_DB_PASSWORD`,
`CONSOLE_DB_PASSWORD`, `ZERO_DB_PASSWORD`) in `.env`.

zero-cache follows changes through logical replication, so its role has
`REPLICATION`. That reaches further than its grants: a replication
connection can decode every change to every table in the database,
including API key hashes and Better Auth's sessions and accounts. So treat
zero-cache as trusted as the API and the console: run the image you
trust, keep `ZERO_DB_PASSWORD` as secret as the others, and never let
Postgres be reached from outside the compose network. Port 4848 must stay
public, because browsers sync through it; its admin pages need
`ZERO_ADMIN_PASSWORD`.

An install made before these roles has only the superuser. After adding
the three passwords to `.env`, hand the tables to their roles and start
zero-cache's copy afresh (it rebuilds it from the API's tables):

```bash
docker compose up -d postgres
docker compose exec postgres sh /docker-entrypoint-initdb.d/roles.sh
docker compose exec postgres psql -U skywake -c 'DROP SCHEMA IF EXISTS zero, zero_0, "zero_0/cvr", "zero_0/cdb" CASCADE'
docker compose rm -sf zero && docker volume rm skywake-hosted_zero
docker compose up -d
```

The console also holds `SKYWAKE_API_ADMIN_TOKEN`. It can only create
organizations: everything else the console does, it does as the signed-in
person.

## Your own bucket

The bundled S3 server is fine to try Skywake. For real use, point
`SKYWAKE_STORE` at a bucket in AWS S3, Cloudflare R2 or any S3 with
conditional writes, set its keys, and set `AWS_ENDPOINT` (for AWS,
`https://s3.<region>.amazonaws.com`).

## Credentials for one namespace

By default the API, and any daemon you give the bucket's keys, can reach
the whole bucket. To hand daemons and the CLI credentials that reach only
their own namespace, give the API an IAM role it may assume
(`SKYWAKE_API_STS_ROLE_ARN`; with an S3-compatible store, also its STS
endpoint in `SKYWAKE_API_STS_ENDPOINT`). The role needs read, write and list
on the bucket; each credential gets a session policy that narrows it to one
namespace's folder, for 15 minutes (`SKYWAKE_API_STS_SECONDS`, at most an
hour).

What the credentials can do:

- Read and write objects in the namespace's folder, and nothing outside it.
- Never delete: deleting a branch writes an empty ref, and garbage
  collection runs in the API with its own credentials.
- Never write the ref of a protected branch, so it changes only through a
  merge in the API.
- Never write under `gc/`, so they cannot hold garbage collection's lock
  and make every writer of the namespace wait.
- Still overwrite the refs of other branches, the content objects of that
  namespace, and its `deleted/` records. Content is checked against its hash
  when read, so a bad write is detected, not silent: it can break reads (a
  denial of service), but not change data unnoticed.

Credentials already handed out keep working until they expire (900 seconds
by default). Revoking a key, or protecting a branch, takes full effect only
then.

## Health and metrics

`/health` answers while the API runs; `/ready` also checks Postgres and the
bucket (at most once every 5 seconds), and the compose health check uses it. Prometheus metrics are on port
9464 inside the compose network (`SKYWAKE_API_METRICS_LISTEN`). The API logs
one JSON line per request, with its id, the caller and the time it took.

## On a server

Put the three public services behind HTTPS, and set `CONSOLE_URL`, `API_URL`
and `ZERO_URL` in `.env` to the addresses people use. The ports can be
changed with `CONSOLE_PORT`, `API_PORT` and `ZERO_PORT`.

## More traffic

The API can run as many copies as you need behind a load balancer: see
"Running many" in `apps/api/README.md`.

## Update

```bash
git pull
scripts/start.sh
```

The API and the console update their tables when they start.

Your data lives in the `postgres`, `s3` and `zero` volumes.
`docker compose down` keeps them; `docker compose down -v` deletes them.
