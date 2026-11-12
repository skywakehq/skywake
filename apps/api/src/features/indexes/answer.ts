import type { indexes } from "@skywake/contract";
import type { Index as Engine, IndexRequest } from "@skywake/engine";

import type { Bill } from "./usage.ts";

export async function answer(
  index: { store: Engine },
  branch: string,
  requests: IndexRequest[],
  consistency: indexes.Consistency | undefined,
  bill: Bill,
) {
  const started = performance.now();
  await bill.admit("queries");
  const eventual = consistency === "eventual";
  const { results, reads } = await index.store.multi(branch, requests, { eventual });
  bill.count("queries", requests.length);
  return {
    results,
    billing: bill.counts,
    performance: {
      server_ms: Math.round(performance.now() - started),
      cache_temperature: reads.temperature,
      cache_hit_ratio: reads.hitRatio,
    },
  };
}
