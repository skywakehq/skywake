import { EngineError, type Index } from "@skywake/engine";

export async function statsOf(store: Index, branch: string) {
  try {
    const stats = await store.stats(branch);
    return {
      rows: stats.rows,
      deleted_rows: stats.deletedRows,
      segments: stats.segments,
      indexed_rows: stats.indexedRows,
      unindexed_rows: stats.unindexedRows,
      clusters: stats.clusters,
      bytes: stats.bytes,
    };
  } catch (error) {
    if (error instanceof EngineError && error.kind === "unavailable") return null;
    throw error;
  }
}
