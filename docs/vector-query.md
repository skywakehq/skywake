# Vector queries

A vector query does a bounded amount of work, set by its `k` and recall target, never by the size of the
index or how unusual the query is. Inside that bound it spends effort where the ranking is still uncertain.

## Stages

1. **Probe.** Groups are read nearest centroid first. The calibrated share of groups for the recall target
   decides how many, capped so a query reads the codes of at most about 1M rows. An exact scan of every
   vector runs only when asked for (`recall(1.0)`, an explicit `probe`) or when the index holds at most 64k
   rows.
2. **Estimate.** One-bit RaBitQ codes give every row in the probed groups a distance with an error bound.
   Rows whose lower bound cannot beat the k-th upper bound are dropped.
3. **Refine.** Four-bit extended RaBitQ codes (Gao et al., SIGMOD 2025) give the remaining rows, nearest
   first by their one-bit estimate, a distance about ten times tighter: at most `512 × max(4k, 40)` rows,
   read in one pass and scored on every core. Rows whose refined lower bound cannot beat the refined k-th
   upper bound are dropped.
4. **Rerank.** Full vectors are read for the best `max(4k, 40)` rows by refined estimate, then in doubling
   batches while a refined lower bound still beats the exact k-th distance, up to eight times that.

Each stage's reads and memory are bounded: codes for the probed rows, `528` bytes per refined row (1024
dimensions), and `8 × max(4k, 40)` full vectors.

## Why four bits

One-bit codes are enough to throw away most rows, but not to rank the last few thousand when their true
distances sit close together. That happens for queries far from all the data, such as uniform random
vectors: every row is about equally far, the one-bit error is wider than the gaps, and the rows picked
for exact scoring were close to random (recall@10 0.03 on Cohere 1M). Four bits cut the error by 7 to 10
times across metrics and dimensions while costing an eighth of a full vector, so a small exact rerank
is enough again.

On Cohere 1M (768 dimensions, cosine), on a laptop:

| Queries           | Before           | After            |
| ----------------- | ---------------- | ---------------- |
| held-out, default | 0.958 at 1.3 ms  | 0.959 at 1.4 ms  |
| uniform, default  | 0.034            | 0.607 at 8.5 ms  |
| uniform, 32 probes| 0.030            | 0.647 at 8.1 ms  |

Uniform queries still recall less because their true neighbours spread over far more groups than the
calibration, measured on rows of the index itself, plans for.

## Format

Format 16. For columns of 256 dimensions or more, each cluster blob appends one record per row after its
vectors: the four-bit levels, three factors and a four-byte check. Smaller vectors rerank every candidate
exactly, so they get no records and keep the older format. The offsets in `ClusterRef` do not cover it, so older blobs read as before.
A column's `Clusters` says `extended` once every piece has records, which is true after a full build and
stays true as appends add pieces. Older indexes keep `extended` false and skip the refine stage until their
next full build; they are written in format 15 until then.
