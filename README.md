# Skywake

**Vector and full-text search on your own bucket.** An open-source alternative to turbopuffer.

Skywake is a search index that keeps every byte in object storage you own, such as S3 or R2.
The servers hold only caches. One query searches by meaning, keywords and filters.

```bash
npm install -g skywake
skywake deploy        # plans, prices and runs it on this machine or your cloud
```

[Read the docs →](https://skywake.dev/docs)

## Quickstart

Set `SKYWAKE_API_KEY` (or run `skywake login`), then:

```ts
import { Skywake } from "skywake";

const products = new Skywake().index("products");
await products.upsert([
  { id: 1, text: "red running shoes", price: 89 },
  { id: 2, text: "waterproof hiking boots", price: 140 },
]);
console.log(await products.query("shoes for running", { filter: { price: { lt: 100 } } }));
```

```python
from skywake import Skywake

products = Skywake().index("products")
products.upsert([
    {"id": 1, "text": "red running shoes", "price": 89},
    {"id": 2, "text": "waterproof hiking boots", "price": 140},
])
print(products.query("shoes for running", filter={"price": {"lt": 100}}))
```

```bash
skywake upsert products products.jsonl
skywake query products "shoes for running" --filter "price < 100"
```

The first upsert makes the index and works out its schema. Text is embedded for you, or bring
your own vectors.

## What it does

- **Vector search**: IVF clusters with RaBitQ codes, with filters applied during the search
- **Full-text search**: BM25 over every text field, with phrases, languages and stopwords
- **Hybrid**: a string query searches by meaning and keywords together
- **Filters, sorting and aggregations**: count, sum, average, min and max, overall or by group
- **Branches**: fork an index without copying data, write to the fork, merge it back
- **Versions**: read, fork from or restore any earlier version
- **Your bucket**: any S3 with conditional writes, such as AWS S3, Cloudflare R2 or RustFS

## Numbers

| On AWS, in the bucket's region |         |
| ------------------------------ | ------: |
| cold query, 10M vectors        |  411 ms |
| warm query, 10M vectors        | 10.1 ms |
| cold query, 1M vectors         |  153 ms |
| warm query, 1M vectors         |  2.8 ms |

Every number, with its full report: [docs/benchmarks.md](docs/benchmarks.md)

## Install

| Use             | Install                                        |
| --------------- | ---------------------------------------------- |
| CLI, MCP server | `npm install -g skywake`, then `skywake login` |
| Python          | `pip install skywake`                          |
| TypeScript      | `npm install skywake`                          |
| Go              | `go get github.com/skywakehq/skywake/sdks/go`  |

Java, C#, Ruby and Rust SDKs are in [`sdks/`](sdks). `skywake mcp` runs an MCP server with tools
to search and write indexes.

## Self-host

- **Guided:** `skywake deploy` finds where it can run, shows the plan and the monthly cost, and
  asks before it changes anything. `skywake deploy cost` compares clouds and sizes.
- **One machine:** `scripts/start.sh`, or [docker/README.md](docker/README.md)
- **Your cloud:** the Helm chart in [deploy/helm/skywake](deploy/helm/skywake/README.md), or the
  Terraform module in [deploy/terraform/aws](deploy/terraform/aws)

## Develop

```bash
scripts/dev.sh        # the console, API and sync from source, with live reload
scripts/dev.sh all    # plus the site and docs on http://localhost:3000
```

| Folder      | What's in it                                   |
| ----------- | ---------------------------------------------- |
| `crates/`   | the Rust index engine, cache node and CLI      |
| `apps/`     | the API, console, website and docs             |
| `sdks/`     | clients in seven languages                     |
| `packages/` | the API contract and the design system         |
| `docker/`   | self-hosting with Docker Compose               |
| `deploy/`   | the Helm chart, Terraform and the deploy tests |

The design in depth: [docs/how-it-works.md](docs/how-it-works.md) ·
Contributing: [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md)

## License

[Apache 2.0](LICENSE)
