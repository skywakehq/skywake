# Engine v2: the query engine for counts, aggregation, order by, and faster search

Status: **design and build plan, awaiting approval.** No engine code is written until this is approved.

Goal: beat turbopuffer v3 on every workload of its published benchmark by a wide margin, measured the way
they measure, with a design that answers most queries without reading rows rather than reading rows faster.

Revision 2 folds in an independent review: every hot query reads the branch head from storage today, indexes
without vectors have none of the structures v1 of this doc relied on, the FTS cold path was misdescribed, and
Tantivy cannot reach the FTS targets.

## 1. The bar

turbopuffer v3, p90, 10M documents per namespace in GCP us-central1, one load generator in region, open loop at
8 QPS for 10 minutes; hot is a 100% cache hit ratio, cold is the cache disabled
([turbopuffer.com/v3](https://turbopuffer.com/v3), Nov 16 2026). They publish p90 only.

| Workload                          |   v3 p90 |   v2 p90 | Their mechanism                                    |
| --------------------------------- | -------: | -------: | -------------------------------------------------- |
| vector, hot                       |    20 ms |    23 ms | SPFresh clusters                                   |
| vector, cold                      | 1,255 ms | 1,324 ms | "inherently noisy", not a v3 target                |
| FTS, hot                          |    18 ms |    19 ms | vectorized MAXSCORE on a shared posting layout     |
| FTS, cold                         |   306 ms |   364 ms | statistics and postings in one round trip          |
| count, hot                        |    22 ms |  23.5 ms | index statistics                                   |
| count, cold                       |    29 ms |    85 ms | index statistics                                   |
| filtered count, hot               |    22 ms |  23.5 ms | popcount of a filter bitmap                        |
| filtered count, cold              |   128 ms |   138 ms | bitmaps built page by page                         |
| grouped count, 1,000 groups, hot  |   521 ms | 26,082 ms | hash map over contiguous columns                   |
| order by attribute, filtered, hot |    22 ms |   218 ms | dynamic top-k filter                               |

Datasets: Cohere Wikipedia 1024-d; MS MARCO v2.1; synthetic rows with numeric `popularity` and 100 categories;
a string attribute with 1,000 values. No selectivity, top_k, or query terms are published.

Their hot rows sit at ~20 ms whatever the engine does, and count cold is only 7 ms above count hot. Both point
to a fixed per-query cost, likely a consistency read of the namespace's metadata. That cost is the first thing
to beat (3.0).

## 2. How the index works today

### Storage

- **Branch head** (`store/head.rs`): a small mutable object with the version hash and **hints**, objects the
  reader prefetches alongside the version.
- **Version** (`format/mod.rs`, format 10): `tail` segments written since the last build (postcard rows);
  `built` segments, used only when the index has no vector column; `ann`, the vector index; `text`, Tantivy
  parts.
- **`ann`**: per vector column, IVF clusters of ~2,000 rows, one blob each,
  `[header][codes][attributes][vectors]` (`format/cluster.rs`). The attributes section is a postcard `Attrs`:
  per attribute a `Vec<Option<Value>>`, plus `value → rows` sets for keyed kinds. Also the **row map**
  (`ann.rows`, id → cluster per column, 1,000 ids a page, hashed by id), a **filter sample**, and **filter
  parts** (rows sorted by one attribute, in blocks carrying the value, the other filter attributes, and RaBitQ
  codes).
- **Without a vector column there is no `ann`** (`build/mod.rs:64`): no row map, no clusters, no filter parts.
  Reads replay every built segment, including rows later overwritten.
- **Caches**: an in-memory LRU keyed by content hash behind one `Mutex` (`store/cache.rs`), and an optional disk
  cache of whole blobs.

### The read path

- **Every query starts with a head GET.** `Index::query` → `snapshot()` → `version()` reads the head unless
  the index was opened in the last second (`lib.rs`). The API can use `snapshot_for(epoch)`, which skips it
  while the epoch is unchanged (`bindings/node/src/index/mod.rs:242`), but the epoch moves on every write.
- **Every query loads the tail** and builds a `HashMap` of its ids (`read/tail.rs`), then probes it for every
  built row it touches.
- **Filters** build a bitmap per cluster (`filter/attrs.rs`): keyed equality and `In` OR precomputed sets;
  ranges and numbers test each row through a boxed `Value`. No page is ever skipped.
- **Count, aggregate, order by** all run `live::each` (`read/live.rs`): read every cluster's codes and
  attributes, build a `BTreeMap` per passing row, probe the tail map, then encode a group key into a
  `HashMap` or push the row onto a sort buffer. Estimated at 10M rows: seconds for a count, 10–30 s for a
  grouped count; phase 0 measures them.
- **BM25** (`text/search.rs`): Tantivy block-max WAND, one thread per query. The term dictionary is already in
  the hot blob (`text/part.rs:338`). A cold query: head; version with the hinted hot blobs and a Tantivy open;
  postings plus a **full fieldnorm file per text field** (~8.8 MB on MS MARCO, `text/search.rs:765`); then
  stored documents per hit. On the slow store 240 of the 353 ms are waits; the rest is CPU and the open.
- **Vector** (`read/query/mod.rs`): IVF, calibrated probes, RaBitQ estimates with scalar popcounts
  (`vector/rabitq.rs:177`), parallel across cores, a byte-range rerank. Selectivity comes from a row sample.

### Where each workload loses time

| Workload           | Cost today                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------- |
| every hot row      | a head GET per query, and an O(tail) map per query                                         |
| count, filtered, grouped | a full scan of codes and attributes, a `BTreeMap` and tail probe per row             |
| order by           | the same scan, plus materializing every passing row                                         |
| FTS hot            | single-threaded WAND; per-document hash-set probes for dead and replaced docs               |
| FTS cold           | megabytes per query (fieldnorms, hot blob), a Tantivy open, per-hit document fetches        |
| vector             | scalar RaBitQ; per-row tail probes; cold reads ids and checksums it does not need           |
| no-vector indexes  | full segment replay for every query                                                        |

## 3. The design

The baseline we take as given is turbopuffer v3's: columnar pages, compressed encodings computed on directly,
page-at-a-time bitmaps, filter pushdown, dynamic top-k filters, grouped aggregation, batched cold reads.

What is ours: **every page is immutable and named by its content hash, so anything computed about a page is
computed once at build, stored beside it, and reused by every query, version, and fork that contains it.**
And: **the serving node knows the current version without asking storage.**

### 3.0 Reads without a storage round trip

Index heads move to the **slot owners** the filesystem already runs (`crates/cache/src/heads`): a cache
server owns a slot of branch names by a fenced lease, every head change goes through it, and it flushes heads to
the bucket. An index branch's owner holds its current `Version` resolved in memory. A query routed to the owner
is linearizable with no storage read; a query elsewhere asks the owner (one in-region RPC, ~0.5 ms) instead of
S3 (~20 ms). Without a tier, today's path remains: head GET, or `snapshot_for(epoch)`.

The hot floor becomes the API's own request cost, about 1.5–2 ms end to end. Every hot row is measured with
this mechanism included; no number assumes a held snapshot.

Cold queries still start by reading the head from the bucket ("cache disabled" includes the owner's memory),
and the head can be **hedged**: a second GET after ~12 ms if the first has not answered.

### 3.1 Column parts

Attributes move out of cluster blobs into **column parts**, one per attribute, for indexes with and without
vectors.

- A **page** is a run of rows. With vectors: one IVF cluster of the first vector column, so vector search and
  its filter bitmaps line up row for row. Other vector columns get a per-cluster **locator** (`(page, row)` per
  row) so their filters use the same bitmaps. Without vectors: 8,192 rows in clustering-key order (3.9).
- **Indexes without vectors get a real build**: a row map and pages, so they stop replaying segments.
- A column part is blobs of ≤64 MiB holding each page's **chunk**, and a **column directory**: per page the
  byte range, checksum, and statistics (3.2). An **ids chunk** per page lives in its own part, so attribute
  queries never read RaBitQ codes.
- Encodings, chosen per chunk from the chunk: constant, dictionary, run-length, frequency, bit-packed integers
  (frame of reference, for ints and timestamps), plain (floats, long strings). Validity is a separate bitmap.
- **Dictionaries are per column with stable, append-only codes**, plus a rank array giving each code's sort
  position. A new value gets the next code, so an incremental build rewrites only the pages it touches. A full
  build renumbers in sorted order.

### 3.2 Page statistics: answer from metadata first

Each page's directory entry: row count, missing count, min and max, and for dictionary columns up to 4,096
values a sparse **histogram** (code → count); for list kinds the same over items; otherwise a 256-byte
HyperLogLog for the planner. The column directory also carries **column totals**: the merged histogram,
global min and max, counts. The Version carries `rows`, the exact live count at build.

| Query                                       | Answered from                                                 |
| ------------------------------------------- | ------------------------------------------------------------- |
| `count(*)`                                  | `rows` plus the tail correction (3.4)                         |
| `count where category = x`                  | totals plus the tail correction                               |
| `count group by s`                          | totals plus the tail correction                               |
| `count where a = x and b > y`               | composite projection, O(log n) (3.6), or pages: fully covered pages add their histogram, boundary pages scan |
| `count group by s where popularity > p`     | fully covered pages add histograms; boundary pages scan       |
| `min`, `max`                                | totals, unless the tail touches the extreme                   |

### 3.3 Vectorized execution

Page-at-a-time over selection bitmaps; never a row-at-a-time `Value`.

- Predicates run on the encoding: constant → all or none; dictionary → evaluate once per dictionary entry,
  then map codes; run-length → fill runs; packed integers → lane compares.
- `And`, `Or`, `Not` word by word, short-circuiting pages statistics prove all-pass or all-fail.
- Kernels are plain fixed-width loops that auto-vectorize, with `std::arch` versions (AVX2, AVX-512, NEON) for
  the hottest: code gather, packed compare, masked popcount, dense group counting, RaBitQ batch scoring. Each
  has a scalar reference and a property test.
- Pages run across cores on a work-stealing pool.
- A query resolves its version's columns **once** into an immutable in-memory structure (directories,
  dictionaries, decoded hot chunks). The page loop never touches the shared cache's lock.

### 3.4 The tail: dead bitmaps and retractions

Per segment, a **retraction sidecar**: the `(page, row)` each of its ids replaced or deleted, and the
histogram deltas those rows take away. The builder writes it right after the segment commits; until it lands,
a reader computes it from the row map (O(segment)) and caches it by segment hash. Queries:

- AND each page's **dead bitmap** (from the sidecars) into its selection; pages with none skip it.
- Correct metadata answers: `rows` and totals minus the retracted deltas, plus the tail's own rows.
- The tail's own rows run through the same engine as one more small page set.

Commit stays read-free. The O(tail) `HashMap` per query goes away.

### 3.5 Grouped aggregation

Group keys over dictionary columns are codes, so groups are a **dense array** indexed by code (or a
mixed-radix code across several columns up to 1M groups): one add per passing row, no hashing, per-thread
arrays merged at the end. Hash maps keyed by code tuples for the rest. `sum`, `avg`, `min`, `max` read decoded
lanes of passing pages only; fully covered pages contribute stored per-page sums and extremes.

### 3.6 Order by and projections

- **Zone-map order**: rank pages by their best bound for the sort key; keep a top-k heap whose kth value is a
  dynamic filter; stop when the next page cannot beat it. Within a page the dynamic filter is one more
  predicate. Only the final k rows read `include`d columns (**late materialization**).
- **Composite projections** for the shapes that matter: rows sorted by `(filter key, sort key)`, e.g.
  `(category, popularity)`, in a light block format (values and page/row pointers, no RaBitQ codes), with
  **cumulative counts** per block. A filtered order by is a seek and a read of k rows; a filtered count of
  `category = c and popularity > p` is two seeks and a subtraction.
- Projections are rebuilt **incrementally**: only blocks whose rows changed, unlike filter parts today, which
  are rebuilt whole when clusters change (`filter/mod.rs:120`).

### 3.7 Cold queries: fewest waves

- The Version carries a **skeleton**: `rows`, column totals for dictionary columns up to 64 KB, and the
  directories' hashes. Hints bring the directories in the same wave as the version.
- The planner then issues **every read it predicts in one wave**, coalescing ranges within 256 KiB, with
  hedged GETs for stragglers. A second wave only when a prediction misses.
- Optional **fast tier**: the head, versions, skeletons and directories (under 1% of bytes) on S3 Express One
  Zone (~5 ms a request); bulk data stays on S3 Standard.

Waves per cold query: count 2 (head, version); equality count 2; conjunction count 3; order by 3; vector 3;
FTS 3.

### 3.8 Planner with exact statistics

From totals and page histograms (exact for dictionary columns), per query: filter-first or vector-first and
the probe count; metadata, projection, page-skip or scan for counts; projection, zone-map order or scan for
order by; clause order by selectivity and encoding cost. Plans are cached by `(version, query shape)`.

### 3.9 Adaptive layout

A bounded per-index log of query shapes (names and operators, never values). At build: the **clustering key**
for no-vector indexes (the most range-filtered or ordered attribute, so zone maps are disjoint), which
**composite projections** to keep, and dictionaries for frequently grouped columns past 64K values.

### 3.10 Caches that forks share

- Decoded pages are cached by chunk hash: a fork, and every later version that kept a page, hit them.
- Per-page partial results (a page's bitmap for a normalized predicate, its partial tally) are cached by
  `(page hash, predicate)`, so a version that changed 1% of pages recomputes 1%. **Off in benchmark runs**,
  which also use unique queries.
- A fork's `warm()` fetches only what its parent's cache lacks.

### 3.11 Our own text engine

Tantivy cannot reach the FTS targets: a cold query must open an index and read megabytes. We write our own,
built from the same tokenizers and analyzed text, keeping Tantivy for highlighting and fuzzy expansion until
replaced:

- **Posting file addressed by term hash.** Fixed buckets hold each term's entry: document frequency, block-max
  index, and a **high-impact prefix** with inlined ids and impacts. A cold query computes its buckets from its
  terms and fetches them in the same wave as the version. Long postings come in wave 3; stored fields only for
  hits outside the prefix.
- **Norms quantized into the postings** (one byte per entry), so there is no fieldnorm file.
- **Block-max MAXSCORE**, batched and SIMD; threshold primed from the stored per-term top impacts; doc-range
  parallelism across cores with a shared threshold.
- Dead documents from the same retraction sidecars.
- Ranking matches today's BM25 (k1, b per query); the oracle compares scores to Tantivy's within 1e-4.

### 3.12 Vector search

- Batched, FastScan-style RaBitQ scoring with lookup tables and `VPOPCNTDQ`/NEON, replacing per-row scalar
  popcounts.
- Dead bitmaps replace per-row tail probes, so the scanned section drops ids and checksums (they move to the
  rerank side).
- Exact selectivity from 3.8 replaces the sample.
- Cold bytes: smaller clusters where calibration allows, an f16 or i8 rerank copy, waves of at most 64 GETs.

### 3.13 Not doing

- New vector index structure: we are ahead cold; v2 changes scoring and bytes read, not IVF.
- A general SQL planner: only our APIs (`query`, `search`, `hybrid`, `order`, `rank`, `aggregate`, `count`).
- Result caches in benchmarks, in-process timings, or quiescent-only runs (6.2).

## 4. API

- New `count(filter)` on `Snapshot`, `Index`, `Shards`, and the node binding.
- `Aggregate`, `Order`, `Rank` keep their shapes; implementations move to the engine.
- No change to `sdks/` or `apps/www`; the API route for `count` comes with the SDK work on `dx-v2-spec`.

## 5. Migration with no downtime

1. **Release N reads format 11 and GC-marks its objects** but still writes format 10. A format-10 binary
   rejects format 11 (`format/legacy.rs:576`) and its GC would sweep unknown objects (`history/gc.rs`), so
   nothing writes 11 until every reader and collector runs N.
2. **Release N+1 writes format 11.** The builder backfills column parts for existing indexes as a normal
   version change (compare-and-swap on the head), cluster by cluster, without re-clustering; readers and
   writers never stop.
3. Cluster blobs keep their attributes section through N+1, so going back to N stays safe. N+2 drops the
   section from newly written clusters.
4. Index heads move to slot owners only where a cache tier runs; elsewhere the bucket path stays.
5. **Oracle tests** at every step: random schemas, data, filters, deletes, tails and forks run through the
   legacy and new paths, which must agree exactly (scores within 1e-4).

## 6. Measurement

### 6.1 Workloads

`index-bench` gains (or adopts from the proposed `tpuf-v3-bench` session, if it starts):

- `attrs`: 10M rows; `popularity` (float, Zipf), `category` (100 values), `group` (1,000 values), `created`
  (timestamp); without vectors and with Cohere 1024-d.
- count; filtered count `category = c` (1%) and `category = c and popularity > p` (0.1%); grouped count by
  `group`, unfiltered and `popularity > p` (10%); order by `popularity desc limit 10`, unfiltered and
  `where category = c`.
- Vector: Cohere 1024-d, 10M (our published runs are 768-d), recall@10 ≥ 0.95, top_k 10. FTS: MS MARCO v2.1.
- Every query unique: constants and vectors drawn per query, at least 4,800 per run.

### 6.2 Fairness rules

- **End to end through the HTTP API**, from a separate in-region machine, open loop at 8 QPS for 10 minutes,
  on real S3. Report p50, p90, p99, recall, waves, GETs and bytes per query.
- Freshness included: hot numbers run with the slot-owner path (3.0); cold numbers read the head from the
  bucket, in a fresh process per query.
- A second run of each with ~1% of rows in the tail.
- Partial-result caches off. S3 Express results in their own rows, beside S3 Standard.
- The local **slow store** stays the development gate. It gains a per-byte cost and a latency tail so bytes
  and hedging show up; numbers from it are not published.
- Runs on AWS need the user's go-ahead each time.

### 6.3 Targets (p90, end to end)

| Workload                | tpuf v3 | Target, S3 Standard       | Target, fast tier | Margin    |
| ----------------------- | ------: | ------------------------- | ----------------- | --------- |
| count, hot              |   22 ms | 1.5 ms                    | same              | 15×       |
| count, cold             |   29 ms | 16–20 ms                  | 5–6 ms            | 1.5–5×    |
| filtered count, hot     |   22 ms | 2 ms                      | same              | 11×       |
| filtered count, cold    |  128 ms | equality 40 ms, conjunction 70 ms | 12 / 35 ms | 2–10×     |
| grouped count, hot      |  521 ms | 2 ms unfiltered, 8 ms filtered | same         | 65–250×   |
| order by, filtered, hot |   22 ms | 2 ms                      | same              | 11×       |
| vector, hot             |   20 ms | 5 ms                      | same              | 4×        |
| vector, cold            | 1,255 ms | 300 ms                   | 120 ms            | 4–10×     |
| FTS, hot                |   18 ms | 4 ms                      | same              | 4.5×      |
| FTS, cold               |  306 ms | 110 ms                    | 35 ms             | 3–9×      |

A target is met when two runs both beat it.

## 7. Build plan

Every phase lands as commits on `engine-v2`, each passing `cargo test --workspace`, `cargo clippy
--all-targets -- -D warnings`, and `cargo fmt --check`. Every phase ends with an `index-bench` run on the slow
store, its numbers appended to section 8, and a short hand-over note. Code follows the repository's rules:
small modules, no comments, nothing in `apps/www` or `sdks/`.

New code lives in `crates/index/src/engine/` (planner, kernels, execution), `format/columns/` (parts,
encodings, statistics), `format/projection/`, `text/postings/`; existing modules shrink as their paths move.

### Phase 0: measure (≈1 week)

- `benchmarks/src/workloads/attrs/`: the `attrs` dataset generator, the six query families, unique constants.
- An open-loop driver: fixed QPS, duration, p50/p90/p99, waves, GETs, bytes; hot and cold modes.
- The slow store gains `--bytes-per-ms` and `--tail` (a latency distribution).
- Cohere 1024-d fetch in `datasets/fetch.py`.
- Baseline today at 1M and 10M on the slow store. **Exit:** section 8 has a measured "today" row for every
  workload.

### Phase 1: storage (≈3 weeks)

1. `format/columns/encode/`: the six encodings, each with encode, decode, and predicate kernels; property tests
   against a plain `Vec<Option<Value>>`.
2. `format/columns/`: chunk, page directory, statistics, totals, stable dictionaries with rank arrays.
3. Builder: column parts and ids chunks in `build/full` and `build/grow` (touched pages only); locators for
   secondary vector columns; `Version.rows`.
4. A build for **indexes without vectors**: row map plus pages in clustering-key order.
5. Format 11 in `format/mod.rs` and `legacy.rs`; GC marks every new object; release-N mode (read 11, write 10)
   behind an option.
6. Oracle harness `testing/oracle.rs`: random indexes through both paths.

**Exit:** every existing test passes on both formats; oracle green over 10k random cases; backfill of a
10M-row index measured.

### Phase 2: counts and aggregation (≈2 weeks)

1. `engine/plan`: resolved-version structure; statistics-driven choice of metadata, page-skip, or scan.
2. `engine/filter`: page bitmaps from encodings, zone-map pruning, short-circuits.
3. Retraction sidecars: written after commit by the builder, computed by readers when missing.
4. `count`; `aggregate` on dense code arrays and hash fallback; per-page stored sums and extremes.
5. SIMD kernels for gather, packed compare, masked popcount, group count.

**Exit:** count, filtered count and grouped count beat section 6.3 hot targets in-process on the slow store;
oracle green with tails and forks.

### Phase 3: order by (≈1.5 weeks)

1. Zone-map page order, dynamic top-k filter, late materialization for `order` and `rank`.
2. Composite projections with cumulative counts, light block format, incremental rebuild.
3. Planner picks projection, zone-map order, or scan.

**Exit:** order by, filtered and unfiltered, beats target in-process; filtered count with a range uses the
projection.

### Phase 4: freshness and the end-to-end harness (≈2 weeks)

1. Index heads through slot owners: route, owned resolved versions, flush, fallback to the bucket.
2. API routing of index queries to the owner; `count` through the node binding.
3. End-to-end harness driving the HTTP API, ready for AWS (`benchmarks/cloud/aws`).
4. First AWS run, **with the user's go-ahead**: all hot rows end to end.

**Exit:** hot rows within 20% of target end to end; this phase can start in parallel with phase 2, since it
touches `crates/cache` and the binding, not the engine.

### Phase 5: text engine (≈4 weeks)

1. `text/postings/`: term-hash buckets, block-max index, high-impact prefix, quantized norms; built beside
   Tantivy parts.
2. Batched block-max MAXSCORE with SIMD, threshold priming, doc-range parallelism.
3. Filters and dead documents from engine bitmaps and sidecars.
4. Oracle against Tantivy's scores; MS MARCO MRR@10 and nDCG@10 unchanged.

**Exit:** FTS hot ≤ 4 ms in-process, cold 3 waves, quality equal to today's.

### Phase 6: cold path (≈2 weeks)

1. Skeleton in the Version; hints for directories and term buckets.
2. Planned single-wave reads with range coalescing; hedged GETs.
3. Optional fast tier for metadata objects, behind an option; **S3 Express only with the user's go-ahead**.

**Exit:** every cold row at its wave count; end-to-end cold run on AWS.

### Phase 7: vector (≈2 weeks)

1. FastScan-style batched RaBitQ with SIMD.
2. Dead bitmaps in the vector path; ids and checksums out of the scanned section.
3. Exact selectivity from statistics; f16/i8 rerank copy; cluster size from calibration.

**Exit:** vector hot ≤ 5 ms and cold ≤ 300 ms on Cohere 1024-d, recall ≥ 0.95.

### Phase 8: adaptive layout (≈1.5 weeks)

Query-shape log, clustering key choice, automatic composite projections, per-page partial-result cache.

**Exit:** a range-heavy workload on a no-vector index gets faster after one rebuild with no schema change.

### Order and parallelism

`0 → 1 → 2 → 3 → 5 → 6 → 7 → 8`, with phase 4 alongside 2–3. Phases 5 and 7 can run in parallel after 3,
since they touch different modules. About 21 weeks of serial work, 15 with both overlaps.

### Risks

| Risk                                           | Mitigation                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| our BM25 drifts from Tantivy's ranking          | score oracle at 1e-4, MS MARCO quality gate in every phase-5 commit      |
| slot owners for index heads widen the blast radius of a cache-tier bug | bucket fallback; owners flush within seconds; oracle on failover |
| backfill doubles attribute bytes for a release  | measured in phase 1; N+2 removes the old section                         |
| fast tier is single-AZ and pricier              | optional, metadata only, the bucket stays the record                     |
| targets assume the API floor is ~1.5 ms        | phase 4 measures it before hot claims are made                           |

## 8. Results

Filled in phase by phase: today, then each phase, slow store and (where approved) AWS end to end.

| Workload | tpuf v3 | Today | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 | Phase 7 |
| -------- | ------: | ----: | ------: | ------: | ------: | ------: | ------: | ------: |

## 9. Decisions for approval

1. The design above, including our own text engine in place of Tantivy's scoring.
2. Index heads on the filesystem's slot owners (3.0).
3. Fairness rules in 6.2, and AWS runs from phase 4 on, each with a go-ahead.
4. The optional S3 Express tier for metadata (3.7), decided at phase 6.
5. The phase order in section 7.
