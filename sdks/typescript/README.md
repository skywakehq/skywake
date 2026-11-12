# Skywake for TypeScript

A client for Skywake: branches of a filesystem, and search indexes.

```bash
npm install @skywake/sdk
```

```ts
import { Skywake } from "@skywake/sdk";

const sky = new Skywake({ url: "https://api.skywake.dev", key: process.env.SKYWAKE_KEY! });

// Filesystems
const main = sky.namespace("prod/app").branch("main");
const fork = await main.fork("agents/42");
await fork.write({ "notes.md": "# Plan" }, "Add the plan");
await sky.namespace("prod/app").merge("agents/42", "main");

// Search indexes
const products = await sky.indexes.create("prod/products", {
  vectors: [{ name: "embedding", dims: 3 }],
  attributes: [{ name: "tag", type: "string" }],
});
await products.upsert([
  { id: 1, vectors: { embedding: [0.1, 0.2, 0.3] }, attributes: { tag: "billing" } },
]);
const hits = await products.query({
  vector: { column: "embedding", value: [0.1, 0.2, 0.3] },
  topK: 5,
});
```

- **Branches.** `fork` copies nothing; `fork(name, at)` starts at an older
  commit. `protect()` makes a branch change only by merge.
- **Files.** `list`, `read`, `readText`, `write`, `commit`, `checkout` and
  `commitFolder` for a whole folder; `log`, `history`, `diff`, `revert`, `reset`.
- **Indexes.** `query`, `search` (BM25), `hybrid`, `order`, `rank`,
  `aggregate` and `multi`; `upsert`, `patch`, `delete` and `write`.
- **Errors** are `SkywakeError` with `status`, `code`, `requestId` and, for a
  bad field, its `path`. Safe requests are retried.
