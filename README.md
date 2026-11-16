# Skywake

**A scalable filesystem and search engine for AI agents, on your own object storage.**

Skywake gives every agent its own copy of your files and search index. Copies are instant: they share a pointer into your bucket, so you do not duplicate gigabytes for every run. Agents mount the copy like a normal folder, search it by meaning or by keyword, and you merge back only what should stay.

```bash
git clone https://github.com/skywakehq/skywake && cd skywake
scripts/start.sh    # Docker install; console at http://localhost:3100
```

It installs what is missing first, and asks before each install. [Docs](https://skywake.dev/docs) · [Website](https://skywake.dev)

## What it is

Two primitives, one bucket:

| | |
| --- | --- |
| **Filesystem** | Versioned, copy-on-write folders on S3 (or any S3-compatible store). Fork in milliseconds, mount without downloading the tree, autosave every 2 seconds, diff and merge like Git. |
| **Search** | Vector, full-text and hybrid search in the same bucket. Indexes branch and version like files, so agents can try writes without touching production. |

Works with AWS S3, Cloudflare R2, Google Cloud Storage, Azure Blob, RustFS and other stores that support conditional writes.

## Why teams use it

Running many agents on one shared environment usually means slow copies, colliding writes, or a separate search database that drifts out of sync. Skywake keeps files and search together, gives each agent an isolated workspace, and only stores what actually changes.

## Use cases

| Use case | What you get |
| --- | --- |
| **Knowledge bases** | Documents and their search index in one bucket. Agents always answer from the latest version. |
| **Context layers** | Each agent keeps notes in its own folder and finds them again on the next run. |
| **Agent storage / sandboxes** | A working folder that saves to your bucket and reopens on any machine after a crash. |
| **Cloud coding agents** | A ready copy of the repo (with packages and caches) for every agent in ~10 ms. |
| **Document agents** | Agents edit a copy. Nothing reaches main until you approve. |
| **Evals and RL** | Every run starts from the same saved environment, in its own free copy. |
| **CI and builds** | Skip the clone and cache restore. Jobs start from a warm checkout. |
| **Preview environments** | A full workspace for every pull request, with its data and dependencies. |
| **Dataset versioning** | Branch datasets like code. Know which data trained which model. |
| **Shared reference data** | Large shared files download once per machine, however many jobs read them. |

More detail: [skywake.dev/use-cases](https://skywake.dev/use-cases)

## Quick start

### Filesystem

```bash
skywake new main
skywake commit main ./project -m "base image"
skywake new agent-37 --from main     # instant, at any size
skywake mount agent-37 /work         # Linux; saves to the bucket every 2 s
skywake merge agent-37 main          # three-way, conflicts per file
```

- Fork in milliseconds, whatever the size
- Mount without downloading: files stream in as they are read
- Lose at most 2 seconds to `kill -9`; `fsync` means saved
- Merges, claims and sessions for many agents on one codebase

### Search index

```bash
skywake index create prod/products --vector embedding:768 --attr price:number
skywake index upsert prod/products products.jsonl
skywake index query prod/products --vector-file q.json -k 10 -f "price < 10"
```

- Filters, BM25, hybrid and rerank in one query
- Fork an index to try writes without touching `main`
- Pin hot indexes in memory, across replicas

## Numbers

| On AWS, in the bucket's region |         |
| ------------------------------ | ------: |
| fork a 1 GB tree               |   95 ms |
| `aws s3 cp` the same tree      |  28.7 s |
| commit 1 GB                    |   6.4 s |
| cold query, 10M vectors        |  411 ms |
| warm query, 10M vectors        | 10.1 ms |

Full reports: [docs/benchmarks.md](docs/benchmarks.md)

## Install

| Use                | Install                                       |
| ------------------ | --------------------------------------------- |
| CLI                | `npm install -g skywake`                      |
| Python, MCP server | `pip install skywake skywake-mcp`             |
| TypeScript         | `npm install @skywake/sdk`                    |
| Go                 | `go get github.com/skywakehq/skywake/sdks/go` |

Java, C#, Ruby and Rust SDKs are in [`sdks/`](sdks).

## Self-host

- **One machine:** `scripts/start.sh`, or [docker/README.md](docker/README.md)
- **Your cloud:** the Helm chart in [deploy/helm/skywake](deploy/helm/skywake/README.md)

## Develop

```bash
scripts/dev.sh        # console, API and sync from source, with live reload
scripts/dev.sh all    # plus the site and docs on http://localhost:3000
```

| Folder      | What's in it                                       |
| ----------- | -------------------------------------------------- |
| `crates/`   | Rust engine, mount, daemon, cache node and CLI     |
| `apps/`     | API, console, website and docs                     |
| `sdks/`     | clients in seven languages                         |
| `packages/` | API contract and design system                     |
| `docker/`   | self-hosting with Docker Compose                   |
| `deploy/`   | Helm chart                                         |

How it works: [docs/how-it-works.md](docs/how-it-works.md) ·
Contributing: [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md)

## License

[Apache 2.0](LICENSE)
