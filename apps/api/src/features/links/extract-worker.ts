import { parentPort } from "node:worker_threads";

import { type DocumentKind, extract } from "./extract.ts";

interface Asked {
  id: number;
  kind: DocumentKind;
  bytes: Uint8Array;
}

parentPort!.on("message", async ({ id, kind, bytes }: Asked) => {
  const result = await extract(kind, bytes).catch(() => ({ reason: "could not be read" }));
  parentPort!.postMessage({ id, result });
});
