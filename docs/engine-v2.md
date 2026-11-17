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

**Exit:** hot rows within 20% of target end to end.

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

### Phase 9: self-hosting (≈3 weeks)

Today there are four separate ways in (`deploy/compose`, `deploy/helm`, `deploy/terraform/aws`, and a CloudFormation
starter), and only AWS gets the bucket, the database and IAM made for it. Phase 9 makes one path that works the
same on any cloud and that an agent can drive as easily as a person.

1. **One command, `skywake deploy`, for every target.** A laptop is just another target. The targets are
   `local` (Docker), `lite` (one process, no Docker), `docker` (any VM), `kubernetes`, `aws`, `gcp` and `azure`.
   - `skywake deploy` with no arguments is the guided path. It finds the target from what it can already see
     (cloud credentials, a kube context, Docker or none of them), asks only what it can't infer, writes
     `skywake.deploy.toml`, shows the plan and the monthly cost, and applies it after a yes. On a laptop it picks
     `local`, so a first run needs no questions at all.
   - `skywake deploy status`, `logs`, `stop` (keeps the data), `upgrade` (migrations, then a rolling restart) and
     `destroy` (names what it will delete and asks first) work the same on every target.
   - When it finishes, it creates an organization and a key and points the CLI, the SDKs and the MCP server at the
     deployment, so `new Skywake()` works with no settings. `--sample` loads a demo index and disk.
   - Every question has a flag. `--yes --json` runs with no prompts and prints machine-readable steps.
     `--plan-only` never changes anything. The MCP server gets `deploy` and `deploy_status` tools.
   - Secrets go into the cloud's secret manager, a Kubernetes Secret or `~/.skywake`, and are never printed.
2. **One file, `skywake.deploy.toml`.** It holds the target, region, size, domain, and whether to make or reuse
   the bucket and Postgres. Helm values, Terraform variables and the Compose file are all rendered from it. Its
   schema is published, so the docs, the CLI and agents read the same source.
3. **`skywake deploy doctor`.** It checks a running or planned deployment:
   - the bucket's conditional writes, list and range reads, and the time to read from it;
   - Postgres version and `wal_level`;
   - clock skew, ingress and TLS, and that the image versions match.

   Each failure comes with the exact fix. The docs' troubleshooting page is generated from these checks.
4. **What each target needs underneath.**
   - `local` and `docker`: the published images instead of building from a checkout. `scripts/start.sh` and
     `scripts/dev.sh` stay for working on Skywake itself.
   - `lite`: the API with a local folder as the store and an embedded Postgres, in one process.
   - `gcp` and `azure`: Terraform modules shaped like the AWS one, covering GCS, Cloud SQL, workload identity and
     GKE, and Blob, Flexible Server, managed identity and AKS. The store already speaks GCS and Azure Blob
     natively (`crates/core/src/store/open`).
   - `kubernetes`: Helm hardening, with External Secrets, a PodDisruptionBudget, network policies,
     `small`/`medium`/`large` presets, a migrate-before-roll upgrade hook, `helm test` running
     `deploy/test/smoke.sh`, and every dependency optional and bundled (CloudNativePG, MinIO, cert-manager).
5. **One-click buttons**, each running `skywake deploy`:
   - AWS: a CloudFormation quick-create link.
   - GCP: "Open in Cloud Shell".
   - Azure: "Deploy to Azure".
   - Any machine: a single install command.
6. **Docs.** One page per target, plus a sizing guide, the upgrade policy, and backup and restore. Commands come
   from the CLI's own `--help` and the published schema, so they can't drift.

**Exit:** `skywake deploy` gets an empty laptop to a working index in under 2 minutes (`lite` in under 30
seconds), and an empty AWS, GCP or Azure account or a kind cluster in under 10, each with one command, no hand
edits and a passing `doctor`. `local`, `lite` and kind run in CI on every change. The real clouds run weekly,
**each with the user's go-ahead**.

### Order and regression gates

Phases run one at a time, in order `0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9`, so each phase's effect is measured
alone and a regression points at one phase. About 21 weeks.

Every phase ends with the **full suite**, not only the workloads it targets, compared with the previous
phase's run by `benchmarks/compare.py`:

- all ten workloads of section 6.1, hot and cold, at 1M and 10M;
- today's published sets: SIFT-1M and Cohere-10M vector (latency and recall), MS MARCO (latency, MRR@10,
  nDCG@10);
- write throughput, build time, index bytes, and peak memory.

A phase lands only when no number regresses by more than 10% (p90 latency, bytes, build time) or at all
(recall, ranking quality), or when a regression is written up in section 8 and accepted.

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

p90 in ms. "Today" is commit `7c1692d` on the slow store (60 ms a request, 64 in flight), `attrs` workload,
1M rows with 64-d vectors; hot rows include the head read (`hot+head`), cold rows open a fresh index with
empty caches. Full tables: `benchmarks/results/phase0-attrs-1m`.

| Workload                    | tpuf v3 | Today | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 | Phase 7 |
| --------------------------- | ------: | ----: | ------: | ------: | ------: | ------: | ------: | ------: |
| count, hot                  |      22 |   294 |      63 |         |         |         |      62 |         |
| count, cold                 |      29 | 1,778 |     233 |         |         |         |     143 |         |
| filtered count, hot         |      22 |    88 |      68 |         |         |         |      67 |         |
| filtered count, cold        |     128 | 1,526 |     218 |         |         |         |     146 |         |
| grouped count (1,000), hot  |     521 |   422 |      66 |         |         |         |      65 |         |
| order by, filtered, hot     |      22 |    87 |      87 |      75 |         |         |      77 |         |

At 10M rows (load 400 s, build 252 s, index 8.1 GB; `phase0-attrs-10m`, hot rows that overlapped other
work rerun idle in `phase0-attrs-10m-rerun`), p90 in ms:

| Query                        | hot+head |   cold |
| ---------------------------- | -------: | -----: |
| count                        |    2,717 | 17,348 |
| count, category = c          |      128 | 13,618 |
| count, category and range    |      137 | 14,726 |
| grouped count (1,000)        |    4,040 | 17,061 |
| grouped count, range         |      667 | 15,210 |
| order by                     |    5,235 | 19,695 |
| order by, category = c       |      164 | 14,848 |

Every cold query at 10M reads 884 MB in 5,011 GETs over ~165 waves.

Phase 1 changes storage only: column pages are written when `Options.columns` is on (off by default) and no
query reads them yet, so its gate is build time and bytes, not query latency.

Phase 1 gate at 1M rows on the slow store, against phase 0 (`phase1b-attrs-1m-columns-off`, `-on`):

| Setup       | Phase 0 | Columns off | Columns on       |
| ----------- | ------: | ----------: | ---------------: |
| build       |  13.3 s |      13.3 s |  13.7 s (+3%)    |
| build GETs  |   1,306 |       1,306 |            1,306 |
| build PUTs  |   1,510 |       1,510 |            1,559 |
| index       |  802 MB |      802 MB |  822 MB (+2.5%)  |
| peak memory |  1.6 GB |      1.5 GB |           1.5 GB |

Nothing regresses past the gate. A full build encodes column pages from each group of clusters while it fills
them, so it reads nothing back; a first version that read every cluster again cost +16% build time.
Incremental builds still read the clusters they rewrote. Column pages cost about 20 bytes a row for the four
attributes.

Phase 2 gate at 1M rows on the slow store with columns on, against phase 0 (`phase2-attrs-1m`), p90 in ms:

| Query                        | hot, phase 0 | hot | hot+head, phase 0 | hot+head | cold, phase 0 |  cold |
| ---------------------------- | -----------: | --: | ----------------: | -------: | ------------: | ----: |
| count                        |          238 | 0.0 |               294 |       63 |         1,778 |   233 |
| count, category = c          |         10.7 | 2.5 |                88 |       68 |         1,526 |   218 |
| count, category and range    |          7.6 | 6.8 |                82 |       79 |         1,468 |   366 |
| grouped count (1,000)        |          348 | 0.8 |               422 |       66 |         1,982 |   212 |
| grouped count, range         |         48.5 | 3.9 |               117 |       80 |         1,470 |   365 |
| order by                     |          461 | 477 |               532 |      528 |         2,111 | 2,014 |
| order by, category = c       |          8.8 |  11 |                87 |       87 |         1,512 | 1,506 |

Cold counts read 1.4 MB in 55 GETs and 3 waves instead of 87 MB in 507 GETs and 19 waves; counts that scan
pages read 20 MB in 59 GETs and 5 waves. Hot+head is now one head read plus the query. Order by is unchanged
until phase 3: the run flagged its hot p90 (+26%) and p99, so both order-by queries were rerun 60 times with
columns on and off (`phase2-order-check-on`, `-off`) and came out the same (523 vs 530 ms, 9.3 vs 9.2 ms).
Build and bytes are as in phase 1. Every answer is checked against the row path by a differential test over
random writes, deletes, filters and groupings.

Not done in phase 2 and carried forward: retraction sidecars (dead rows are found per query from the tail),
SIMD kernels, parallel page scans, column cost in incremental builds, and the 10M run. Locators for secondary
vector columns move to phase 7.

Review after phase 2 (`d8a0904`): three independent reviews of phases 0 to 2. Fixed: Int sums that saturated
instead of failing, `-0.0` and `0.0` as two groups, Min and Max with NaN depending on visit order, group order
for list keys, vectorless pages fragmenting over many small builds, and benchmark measurement bugs (the first
hot query read the head, waves ignored queueing behind the in-flight limit, build time included `stats()`).
Left for phase 8: column blobs keep a rewritten page's bytes until rebuilt, and dictionaries never shrink.

Phase 3 gate at 1M rows on the slow store with columns on, against phase 2 (`phase3-attrs-1m`), p90 in ms:

| Query                        | hot, phase 2 | hot | hot+head, phase 2 | hot+head | cold, phase 2 | cold |
| ---------------------------- | -----------: | --: | ----------------: | -------: | ------------: | ---: |
| order by                     |          477 | 1.4 |               528 |       69 |         2,014 |  405 |
| order by, category = c       |           11 | 4.1 |                87 |       75 |         1,506 |  642 |

Order by visits pages best bound first using the page min or max, keeps a top-k threshold that skips pages
and rows that cannot win, reads only the sort keys of selected rows, and reads `include`d columns for the
final k rows only. Nothing else moved more than 10%. Ordering by a number column holding NaN used to panic on
the row path; NaN now sorts above every number. Not done in phase 3: composite projections and the planner
(3.6). The filtered cold order by still reads 79 MB in 9 waves; projections are what would cut it.

Phase 4, local, end to end: `index-bench api` loads 1M rows through `POST /v2/indexes/{index}/rows`, waits
for the build, and runs each family open loop at 8 QPS for 30 s after 10 s of warm-up, so every query holds a
read lease and skips the head. The API runs on a laptop against a local folder store and the dev Postgres,
with columns on. p90 in ms; "back to back" is curl with no gap between requests:

| Query                        | engine, hot | API, first run | API, 8 QPS | API, back to back |
| ---------------------------- | ----------: | -------------: | ---------: | ----------------: |
| count                        |         0.0 |            9.8 |        3.6 |              0.78 |
| count, category = c          |         2.5 |           11.5 |        6.9 |                   |
| count, category and range    |         6.8 |           21.5 |         16 |                   |
| grouped count (1,000)        |         0.8 |             13 |         11 |               2.3 |
| grouped count, range         |         3.9 |           23.5 |         20 |                   |
| order by                     |         1.4 |           11.3 |        8.5 |               1.8 |
| order by, category = c       |         4.1 |             17 |         16 |                   |

Cut from the API (`phase4-api-1m-direct`): v2 counts rechecked the API key in Postgres on every call and
emptied the key cache, so the inner v1 call looked it up again; v2 counts and aggregates read the index's
info, which computes its stats, before answering; v2 order by read it for a schema it does not use. Each v2
read is now one in-process v1 call, within 0.3 ms of calling v1 directly. The harness times from the send,
not the scheduled tick, which on this laptop ran up to 3 ms late.

What is left is the machine. At 8 QPS each request arrives after 125 ms idle, and on this laptop the
engine's own `server_ms` for a grouped count is 3 to 4 ms after a gap against 1.6 ms back to back: work that
wakes parked threads runs several times slower, and the more work, the bigger the gap. These numbers cannot
say what a server does; the AWS run (on Linux, with no efficiency cores) is the measurement that counts.

Phase 5, the text engine: `index-bench msmarco` on all 8.8M MS MARCO passages, k1 0.9 and b 0.4, top 10, on a
laptop. Warm is 1,000 dev queries in-process on a local store; cold opens a fresh index per query on the slow
store (60 ms a request, 64 in flight). Posting files are written when `Options.postings` is on (off by default,
`SKYWAKE_INDEX_POSTINGS=on` in the API) (`phase4-text-msmarco`, `phase5-text-msmarco-off`, `phase5-text-msmarco`):

| MS MARCO, 8.8M             | tpuf v3 | Phase 4 | Postings off | Postings on      |
| -------------------------- | ------: | ------: | -----------: | ---------------: |
| warm p50, ms               |         |     2.4 |          2.4 |              0.6 |
| warm p90, ms               |      18 |     9.7 |          9.7 |              2.0 |
| warm p99, ms               |         |    25.7 |         24.1 |              4.2 |
| cold p90, ms               |     306 |     287 |          295 |              273 |
| cold waves, mean / most    |         |   4 / 4 |        4 / 4 |         3.88 / 4 |
| cold GETs                  |         |    38.2 |         38.2 |             15.2 |
| cold bytes                 |         | 23.0 MB |      23.0 MB |          16.1 MB |
| MRR@10, dev small          |         |  0.1835 |       0.1834 |           0.1836 |
| nDCG@10, dev small         |         |  0.2281 |       0.2281 |           0.2282 |
| MRR@10 / nDCG@10, DL19     |         | 0.6940 / 0.5064 | same  |             same |
| build                      |         |  67.2 s |       67.8 s |   77.8 s (+16%)  |
| index                      |         | 6,069 MB |    6,069 MB | 7,097 MB (+17%)  |

With postings off nothing moves (`compare.py`: 0 numbers worse). Quality differs in the fourth decimal between
runs of the same code, because documents with equal scores come back in the order Tantivy numbered them. The
tpuf numbers are end to end on 10M; ours here are in-process, so they are not yet comparable (phase 4's harness
and the AWS run are).

What was built (`crates/index/src/text/postings/`): one posting file per text part, read from the finished
Tantivy segment so documents, frequencies and length norms are the ones Tantivy scores. A term's span holds its
document frequency, a block index with each block's largest frequency and shortest length, blocks of 128
postings (packed gaps, packed frequencies, one norm byte), and its 32 highest-impact postings with their ids.
Spans of up to 128 documents sit in hash buckets; longer ones are found by term hash in a directory that the
head hints. Every stored piece carries a checksum. Ranking is block-max MAXSCORE with a threshold primed from
the stored best postings, over document ranges on up to 8 threads with a shared threshold; dead, replaced and
filtered documents are one bitmap. Scores use Tantivy's own `Bm25Weight`, so they match to rounding. Tantivy
still expands fuzzy words and prefixes, evaluates filters and phrases into the bitmap, and returns stored
attributes and highlights; a query with none of those opens no Tantivy part. Versions with postings are format
12; format 11 still reads and is still written when only columns are on.

Checked by: the scorer against brute force (the exact top k, ties included, on 1, 2 and 7 threads); a
differential test against the Tantivy path over random writes, deletes, builds, filters, k1 and b, two fields,
boosts, repeated words, fuzzy, prefixes, string ids, garbage collection and a cold reopen; damaged spans.

Review after phase 5: three independent reviews of the diff. Fixed: a scan that could loop forever on a
damaged span, format 11 changing shape without a new number, turning postings on doing nothing for an index
with no new writes, short spans all held in memory during a build (now spilled in sorted runs), ids fetched one
hit at a time, blobs recorded only after all uploads, unchecked range reads, hits under the floor, scores that
depended on thread timing in the last digit (now summed in f64), threads without a global cap, and span
parsing on the async runtime.

Phase 5 gaps closed on the same branch (postings on, all 8.8M passages, same harness; `phase5-text-msmarco`
is `d9250e5`):

| MS MARCO, 8.8M             | tpuf v3 | Phase 4  | d9250e5          | Gaps closed     |
| -------------------------- | ------: | -------: | ---------------: | --------------: |
| warm p50, ms               |         |      2.4 |              0.6 |             0.5 |
| warm p90, ms               |      18 |      9.7 |              2.0 |             1.9 |
| warm p99, ms               |         |     25.7 |              4.2 |             4.1 |
| cold p90, ms               |     306 |      287 |              273 |             229 |
| cold waves, mean / most    |         |    4 / 4 |         3.88 / 4 |           3 / 3 |
| cold GETs                  |         |     38.2 |             15.2 |            15.6 |
| cold bytes                 |         |  23.0 MB |          16.1 MB |         21.4 MB |
| MRR@10 / nDCG@10, dev      |         | 0.1835 / 0.2281 | 0.1836 / 0.2282 | 0.1837 / 0.2283 |
| build                      |         |   67.2 s |   77.8 s (+16%)  |  67.1 s (0%)    |
| index                      |         | 6,069 MB | 7,097 MB (+17%)  | 6,646 MB (+9.5%) |

- Cold in 3 waves: documents go to Tantivy in groups (4,096 documents or 128 KB), so a part's documents keep
  their write order and numeric ids form runs. The posting directory, read in wave 2, holds those runs, so a
  hit's id needs no fetch. String and UUID ids still read id blocks in a fourth wave for hits outside each
  term's 32 best postings.
- Cold bytes: not met as asked. Choosing the blocks of a long span that can beat the threshold needs the span's
  block index before its blocks, which is a fourth wave; 3 waves won. Norms are now packed per block
  (259 MB of norms on disk) and short spans no longer repeat their postings as a best list. Cold bytes rose
  from 16.1 to 21.4 MB because the Tantivy hot blob is hinted again (next item); it is still under phase 4.
- Hints: parts with postings hint both the posting directory and the Tantivy hot blob, so filtered, `include`,
  fuzzy and highlighted queries open no Tantivy part inside the query.
- Build and index: posting files are drafted on 8 threads, one term range each, in a deterministic layout.
  Tantivy's `key` fast field now holds each document's write order (it compresses to almost nothing) instead
  of an 8-byte id hash, which saves about 70 MB; ids reach the id map from the writer. Both are now within 10%.
- SIMD and pool: unpacking copies a block into a stack buffer first, 1.8x faster in a micro-benchmark; a
  width-specialized version and a rayon pool measured no better, so neither is kept. No hand-written SIMD.
- Two ids with the same 64-bit key in one part now fail the build with an `Invalid` error instead of one id
  silently answering for both.

Review: two independent reviews. Fixed: old posting directories decoding as garbage (directories now start
with a layout mark and older ones read as corrupt; only `d9250e5` wrote them), grouping without a byte cap
removing Tantivy's back-pressure, per-worker spill runs small enough to exhaust open files at the merge, and
blob layout depending on thread timing.

Still open for phase 6: reading only the needed blocks of long spans (needs a wave budget for it), the fourth
wave for non-numeric ids, the cold bytes of the Tantivy hot blob, and the postings-off gate rerun with grouped
writes (grouping also changes the postings-off build).

### Phase 6: cold path

Gate at 1M rows on the slow store against the same harness at `44258aa` (`phase6-base-attrs-1m` →
`phase6-attrs-1m`), columns on, p90 in ms:

| Cold query                       | Before | After | Waves | Read            |
| -------------------------------- | -----: | ----: | ----: | --------------: |
| count                            |    208 |   143 | 3 → 2 | same            |
| count, category = c              |    208 |   146 | 3 → 2 | same            |
| count, category and range        |    360 |   237 | 5 → 3 | same            |
| grouped count (1,000)            |    209 |   143 | 3 → 2 | same            |
| grouped count, range             |    363 |   233 | 5 → 3 | same            |
| order by, top 10                 |    407 |   205 | 6 → 3 | 3.1 → 2.2 MB    |
| order by, top 10, category = c   |    636 |   253 | 9 → 3 | 79 → 71 MB      |

Hot rows within noise; peak memory 2.5 → 1.6 GB. Columns off (`phase6-base-attrs-1m-off` →
`phase6-attrs-1m-off`): same requests and bytes, every p90 within 8%. MS MARCO, fresh builds, postings on and
off (`phase6-base-msmarco-*` → `phase6-msmarco-*`): same GETs, bytes, MRR and index size; cold p90 229 → 232
(on) and 294 → 293 ms (off); build 62.7 → 65.5 s (on) and 57.5 s both (off).

- Hints: the head names each column's dictionary, totals, directory pages, ids directory and leaders (512
  objects at most), so the columns resolve in the same wave as the Version.
- Page loads run 4 batches of 256 pages at once instead of one batch at a time.
- Order by with a filter sizes its batches by the rows the filter is expected to match (exact for dictionary
  columns, from page histograms) when its pages are not cached; hot queries keep the doubling batches.
- Leaders (format 13): each Number, Int and Datetime column keeps its best 64 rows each way (value, page, row)
  and an edge that no unlisted row beats. An order by without a filter reads only the pages of the rows it
  needs, plus ties. Kept pages carry their leaders; an index written before format 13 gets them at its next
  full rebuild. Formats 11 and 12 still read and are still written when there are no leaders.
- Hedged GETs: a GET still running at 3× the recent median (at least 20 ms) is sent again; the first success
  wins, a failure waits for the other, and at most 8 hedges are in flight. They did not fire on the slow store
  (fixed latency), so their gain needs real S3.

Review: one independent review. Fixed: a fast failing hedge beating a slow success, unbounded hedges, and two
regressions the gate caught (unfiltered order by read the pages of all 64 leaders; filtered order by read every
page when hot). Kept: a filtered order by on data where pages could be skipped may read more than before when
cold; opening an index waits for column metadata even for vector-only queries; up to 4 page batches in memory.

Not done: the AWS end-to-end cold run and the S3 Express tier (both need a go-ahead); vector cold waves
(phase 7); text's fourth wave for string ids and reading only needed blocks of long spans.

### Phase 7: vector

Gate on cohere-1m (1M × 768, cosine) on the slow store against `caf71c5` (`phase7-base-cohere-1m` →
`phase7-cohere-1m`), 200 warm / 50 cold queries, default probes, ms:

| Query        | Cold p90 | Cold p99 | Waves (max) | Bytes/q        | Hot p99   | Recall        |
| ------------ | -------: | -------: | ----------: | -------------: | --------: | ------------: |
| all rows     | 425 → 274 | 490 → 326 | 7 → 4      | 17.5 → 13.9 MB | 3.7 → 1.3 | 0.972 → 0.970 |
| 10% of rows  | 406 → 287 | 463 → 289 | 7 → 4      | 25.0 → 21.7 MB | 3.1 → 2.8 | 0.978 → 0.964 |
| 1% of rows   | 456 → 266 | 458 → 269 | 7 → 4      | 38.0 → 3.5 MB  | 2.2 → 0.9 | 0.978 → 0.996 |

Build 55.6 → 41.9 s; load, index size and peak memory unchanged. Nothing more than 10% worse. Against
turbopuffer v3 (hot 20 ms, cold 1,255 ms) both exit targets are met: hot ≤ 5 ms, cold ≤ 300 ms p90, recall ≥ 0.95.

- Estimates: RaBitQ scores each code from a per-query byte table (one lookup per byte) instead of popcounts
  over 8 bit planes.
- Rerank: with 256 dims or more, only the nearest `max(4k, 40)` estimated candidates are read and scored
  exactly; smaller vectors still rerank every candidate, which keeps their recall.
- Filters: a filter matching under 2% of rows (was 0.3%) scans its rows directly instead of probing clusters.

Not done: the AWS end-to-end cold run (needs a go-ahead) and an API end-to-end vector run.

## 9. Decisions for approval

1. The design above, including our own text engine in place of Tantivy's scoring.
2. Index heads on the filesystem's slot owners (3.0).
3. Fairness rules in 6.2, and AWS runs from phase 4 on, each with a go-ahead.
4. The optional S3 Express tier for metadata (3.7), decided at phase 6.
5. Phases one at a time, each gated on the full suite with no regressions (section 7).
