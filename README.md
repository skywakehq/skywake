# Skywake

**A filesystem for agents, with branches and search, on object storage.**

Give every agent its own branch of one environment. Forks copy a pointer, never data.

```bash
git clone https://github.com/skywakehq/skywake && cd skywake
scripts/start.sh    # everything in Docker; the console on http://localhost:3100
```

It installs what's missing first, and asks before each install. [Read the docs →](https://skywake.dev/docs)

## Quickstart

Set `SKYWAKE_API_KEY` (or run `skywake login`), then:

```ts
import { Skywake } from "skywake";

const app = new Skywake().disk("app");
await app.write("hello.txt", "hi");
console.log(await app.read("hello.txt"));
```

```python
from skywake import Skywake

app = Skywake().disk("app")
app.write("hello.txt", "hi")
print(app.read("hello.txt"))
```

```bash
echo hi | skywake write app/hello.txt
skywake read app/hello.txt
```

## Disks

A disk holds files, with branches and history. Fork one for each agent, then merge back.

```bash
skywake upload ./project app -m "base image"
skywake fork app agent-37            # instant, at any size
skywake mount app@agent-37 /work     # Linux; saves to the bucket every 2 s
skywake merge app@agent-37           # three-way, conflicts per file
```

- **Fork in milliseconds**, whatever the size
- **Mount without downloading**: files stream in as they're read
- **Lose at most 2 seconds** to `kill -9`; `fsync` means saved
- **Search files** with `grep` and `find`, or by meaning (below)

## Search

Turn search on for a disk, and its files are found by meaning and keywords.

```bash
skywake create disk app --search
skywake query app "where is auth handled"
```

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

| Use                   | Install                                        |
| --------------------- | ---------------------------------------------- |
| CLI, MCP server       | `npm install -g skywake`, then `skywake login` |
| Python                | `pip install skywake`                          |
| TypeScript, bash tool | `npm install skywake`                          |
| Go                    | `go get github.com/skywakehq/skywake/sdks/go`  |

Java, C#, Ruby and Rust SDKs are in [`sdks/`](sdks). `skywake mcp` runs the MCP server for agents. Any S3 with conditional writes works: AWS S3,
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
