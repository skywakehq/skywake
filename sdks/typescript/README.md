# Skywake for TypeScript

A client for Skywake, the open-source search index: vector and full-text
search over rows kept in your own bucket, with branches you can fork and merge.

```bash
npm install @skywake/sdk
```

```ts
import { Skywake } from "@skywake/sdk";

const sky = new Skywake();

const products = await sky.createIndex("products");
await products.upsert([
  { id: "mug", text: "a blue coffee mug", price: 12, tags: ["kitchen"] },
  { id: "cup", text: "a white coffee cup", price: 5, tags: ["kitchen"] },
]);
const hits = await products.query("coffee", { filter: { price: { lt: 10 } }, limit: 5 });

const draft = await products.fork("draft");
await draft.update("cup", { price: 7 });
await draft.mergeInto("main");
```

- **Settings.** `new Skywake()` reads the key from `SKYWAKE_API_KEY`, or the
  profile `skywake login` saved. Options set `key`, `url`, `environment`,
  `profile`, `retries` and `fetch`.
- **Rows.** `upsert` takes any number of rows and sends them in batches;
  `update` and `delete` take an id, ids or a filter; `get` and `rows`.
- **Search.** `query` takes text, a `vector`, a `filter`, `sort`, `fields`,
  `limit` and a `mode`; `count` and `aggregate` with `groupBy`, `sum`, `avg`,
  `min` and `max`.
- **Branches.** `fork` copies nothing; `on(branch)` is a handle on another
  branch, `mergeInto` brings its changes back, and `destroy` removes it.
  `versions` and `restore` go back in time.
- **Errors** are `SkywakeError` with `status`, `code`, `requestId` and, for a
  bad field, its `path`. Safe requests are retried.
