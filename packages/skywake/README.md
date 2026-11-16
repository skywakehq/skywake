# skywake

Skywake in one package:

```bash
npm install skywake
```

```ts
import { Skywake } from "skywake"; // the SDK: disks and search indexes
import { shell } from "skywake/bash"; // a bash shell for agents over a disk
import { bashTool } from "skywake/ai"; // that shell as a Vercel AI SDK tool
```

Set `SKYWAKE_API_KEY` (or run `skywake login`), then:

```ts
import { Skywake } from "skywake";

const sky = new Skywake();

const products = sky.index("products");
await products.upsert({ id: 1, text: "red running shoes", price: 89 });
await products.query("shoes for running", { filter: { price: { lt: 100 } } });

const app = sky.disk("app");
await app.write("notes.md", "hello");
const work = await app.fork("agent-1");
await work.write("notes.md", "changed");
await work.mergeInto("main");
```

For agents, give the shell or the tool a disk handle:

```ts
import { shell } from "skywake/bash";

const sh = shell(work);
await sh.run("grep -r TODO .");
```

It also installs the `skywake` command.

## The CLI

```bash
npx skywake --help
npm install -g skywake
skywake login
```

The `skywake` command is prebuilt for Linux on x86_64 and arm64 (glibc). npm installs only the
binary for your machine: it is in `@skywake/cli-linux-x64` or `@skywake/cli-linux-arm64`, optional
dependencies of this package. Elsewhere, build the `skywake-cli` crate from source with cargo.
`skywake mcp` runs on Node, so it works on every platform.

`skywake login` signs in through the browser: it shows a code, and you allow it in the console.
`skywake login --paste` saves a key you paste instead. The key is saved in
`~/.config/skywake/credentials.toml`; `SKYWAKE_API_KEY` and `SKYWAKE_URL` override it.

```bash
skywake upsert products products.jsonl     # or .csv, .parquet, or stdin with -
skywake query products "running shoes" --filter "price < 100" --limit 5
skywake fork products draft
skywake upsert products@draft changes.jsonl
skywake merge products@draft

skywake upload ./project app -m "base"
skywake fork app agent-1
skywake write app@agent-1/notes.md notes.md
skywake diff app@agent-1
skywake merge app@agent-1
```

`NAME@BRANCH` names a branch, and no `@` means `main`. Every command takes `--json`, `--env` and
`--profile`, and destructive ones ask first unless `--yes`. `skywake --help` lists every command.

A row has `id`, then its fields: `{"id": 1, "text": "red running shoes", "price": 89}`. The first
upsert creates the index and works out its schema. Upserts replace rows by id, so after a failure,
running it again is safe.

A filter is written in words: `=`, `!=`, `<`, `<=`, `>`, `>=`, `in (a, b)`, `not in (..)`, joined
with `and`, `or`, `not` and brackets, such as `(tag = a or tag = b) and price < 10`. Quote values
with spaces. The API's JSON form works too.

## MCP

`skywake mcp` (or `npx skywake mcp`) runs the MCP server. It reads `SKYWAKE_API_KEY` and
`SKYWAKE_URL`, plus `SKYWAKE_DISK` and `SKYWAKE_BRANCH` to fix where the file tools work. Without
`SKYWAKE_BRANCH` it forks a branch for the session instead of writing to `main`.

```json
{
  "mcpServers": {
    "skywake": {
      "command": "npx",
      "args": ["-y", "skywake", "mcp"],
      "env": { "SKYWAKE_API_KEY": "sw_...", "SKYWAKE_DISK": "app" }
    }
  }
}
```

## How it is made

The release workflow (`.github/workflows/release.yml`) builds the binaries,
then runs `node scripts/stage.mjs <version> <x64 binary> <arm64 binary>`,
which sets every version, adds the platform packages as optional
dependencies, sets the repository (from `GITHUB_REPOSITORY`, as npm
provenance needs) and copies each binary into its package under `npm/`. It
then publishes the platform packages and `@skywake/sdk` before this one.

`SKYWAKE_BINARY` points the wrapper at another binary, for testing.
