# Skywake

**A filesystem and search index for agents, on object storage.**

Give every agent its own branch of one environment. Forks copy a pointer, never data.

```bash
git clone https://github.com/skywakehq/skywake && cd skywake
scripts/start.sh    # everything in Docker; the console on http://localhost:3100
```

It installs what's missing first, and asks before each install. [Read the docs →](https://skywake.dev/docs)

## Filesystem

```bash
skywake new main
skywake commit main ./project -m "base image"
skywake new agent-37 --from main     # instant, at any size
skywake mount agent-37 /work         # Linux; saves to the bucket every 2 s
skywake merge agent-37 main          # three-way, conflicts per file
```

- **Fork in milliseconds**, whatever the size
- **Mount without downloading**: files stream in as they're read
- **Lose at most 2 seconds** to `kill -9`; `fsync` means saved
- **Merges, claims and sessions** for many agents on one codebase

## Search index

Vector, full-text and hybrid search, kept in the same bucket and branched like files.

```bash
skywake index create prod/products --vector embedding:768 --attr price:number
skywake index upsert prod/products products.jsonl
skywake index query prod/products --vector-file q.json -k 10 -f "price < 10"
```

- **Filters, BM25, hybrid and rerank** in one query
- **Fork an index** to try writes without touching `main`
- **Pin** hot indexes in memory, across replicas

## Numbers

| On AWS, in the bucket's region |         |
| ------------------------------ | ------: |
| fork a 1 GB tree               |   95 ms |
| `aws s3 cp` the same tree      |  28.7 s |
| commit 1 GB                    |   6.4 s |
| cold query, 10M vectors        |  411 ms |
| warm query, 10M vectors        | 10.1 ms |

Every number, with its full report: [docs/benchmarks.md](docs/benchmarks.md)

## Install

| Use                | Install                                       |
| ------------------ | --------------------------------------------- |
| CLI                | `npm install -g skywake`                      |
| Python, MCP server | `pip install skywake skywake-mcp`             |
| TypeScript         | `npm install @skywake/sdk`                    |
| Go                 | `go get github.com/skywakehq/skywake/sdks/go` |

Java, C#, Ruby and Rust SDKs are in [`sdks/`](sdks). Any S3 with conditional writes works: AWS S3,
Cloudflare R2, RustFS and more.

## Self-host

- **One machine:** `scripts/start.sh`, or [docker/README.md](docker/README.md)
- **Your cloud:** the Helm chart in [deploy/helm/skywake](deploy/helm/skywake/README.md)

## Develop

```bash
scripts/dev.sh        # the console, API and sync from source, with live reload
scripts/dev.sh all    # plus the site and docs on http://localhost:3000
```

| Folder      | What's in it                                       |
| ----------- | -------------------------------------------------- |
| `crates/`   | the Rust engine, mount, daemon, cache node and CLI |
| `apps/`     | the API, console, website and docs                 |
| `sdks/`     | clients in seven languages                         |
| `packages/` | the API contract and the design system             |
| `docker/`   | self-hosting with Docker Compose                   |
| `deploy/`   | the Helm chart                                     |

The design in depth: [docs/how-it-works.md](docs/how-it-works.md) ·
Contributing: [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md)

## License

[Apache 2.0](LICENSE)
