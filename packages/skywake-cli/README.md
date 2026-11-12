# skywake

The `skywake` command, from npm:

```bash
npx skywake --help
npm install -g skywake
```

Prebuilt for Linux on x86_64 and arm64 (glibc). npm installs only the
binary for your machine: it is in `@skywake/cli-linux-x64` or
`@skywake/cli-linux-arm64`, optional dependencies of this package. Elsewhere,
build the `skywake-cli` crate from source with cargo.

## Search indexes

`skywake index` works with search indexes through the API. Set where it is
and a key, made in the console under Settings → API keys:

```bash
export SKYWAKE_URL=http://localhost:8080 SKYWAKE_KEY=sw_...
```

```bash
skywake index create prod/products --vector embedding:768 --attr tag:string --attr price:number
skywake index upsert prod/products products.jsonl     # or .csv, .parquet, or stdin
skywake index query prod/products --vector-file q.json -k 5 -f "tag = billing and price < 10" -i '*'
skywake index fork prod/products agents/try-1
skywake index upsert prod/products changes.jsonl -b agents/try-1
skywake index branches prod/products
skywake index build prod/products
skywake index stats prod/products
```

| Command                       | What it does                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `list`                        | The indexes you can reach.                                                     |
| `create NAME`                 | From `--vector NAME:DIMS[:METRIC]` and `--attr NAME:TYPE`, or `--schema FILE`. |
| `get NAME`                    | Its columns, and the counts of `main`.                                         |
| `stats NAME [-b BRANCH]`      | The counts of one branch.                                                      |
| `delete NAME`                 | The index and all its branches. Asks first; `--yes` skips that.                |
| `upsert NAME [FILE]`          | Writes documents, 1000 to a request, 4 requests at once.                       |
| `delete-docs NAME ID...`      | Deletes documents by id.                                                       |
| `query NAME`                  | The nearest documents to `--vector` or `--vector-file`.                        |
| `fork NAME BRANCH [--from B]` | A new branch. Nothing is copied.                                               |
| `branches NAME`               | The branches.                                                                  |
| `delete-branch NAME BRANCH`   | Deletes a branch.                                                              |
| `build NAME [-b BRANCH]`      | Starts clustering the rows, so queries read less.                              |

Every command prints a table, or the API's JSON with `--json`.

A row to upsert has `id`, then each column by name:
`{"id": 1, "embedding": [0.1, 0.2], "tag": "billing"}`. The API's own shape,
`{"id", "vectors", "attributes"}`, works too. In CSV, write a vector as a
JSON list and a list of strings as `a|b`. Ids of only digits become numbers.
Upserts replace documents by id, so after a failure, running it again is
safe.

A filter is written in words: `=`, `!=`, `<`, `<=`, `>`, `>=`, `in (a, b)`,
`not in (..)`, joined with `and`, `or`, `not` and brackets, such as
`(tag = a or tag = b) and price < 10`. Quote values with spaces. The API's
JSON form works too.

## MCP

`skywake-mcp` (`uvx skywake-mcp`, or `pip install skywake-mcp`) gives
agents the same indexes as tools: `list_indexes`, `describe_index`,
`query_index`, `upsert_documents`, `delete_documents` and
`fork_index_branch`. It reads `SKYWAKE_URL` and `SKYWAKE_KEY`; with
`SKYWAKE_NAMESPACE` it also offers file tools for that namespace.

```json
{
  "mcpServers": {
    "skywake": {
      "command": "uvx",
      "args": ["skywake-mcp"],
      "env": { "SKYWAKE_URL": "...", "SKYWAKE_KEY": "sw_..." }
    }
  }
}
```

## How it is made

The release workflow (`.github/workflows/release.yml`) builds the binaries,
then runs `node scripts/stage.mjs <version> <x64 binary> <arm64 binary>`,
which sets every version and the repository (from `GITHUB_REPOSITORY`, as
npm provenance needs), copies each binary into its package under `npm/`,
and publishes the platform packages before this one.

`SKYWAKE_BINARY` points the wrapper at another binary, for testing.
