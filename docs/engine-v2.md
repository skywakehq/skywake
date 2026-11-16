# Engine v2: the query engine for counts, aggregation, order by, and faster search

Status: **design, awaiting approval.** No engine code is written until this is approved.

Goal: beat turbopuffer v3 on every workload of its published benchmark, with a design that answers most of
those queries without reading rows at all, rather than reading rows faster.

## 1. The bar

turbopuffer v3, p90, 10M documents, 8 QPS for 10 minutes; hot is a 100% cache hit ratio, cold is the cache
disabled ([turbopuffer.com/v3](https://turbopuffer.com/v3), Nov 16 2026):

| Workload                          |  v3 p90 |  v2 p90 | What their engine does                                  |
| --------------------------------- | ------: | ------: | ------------------------------------------------------- |
| vector, hot                       |   20 ms |   23 ms | SPFresh clusters                                        |
| vector, cold                      | 1,255 ms | 1,324 ms | "inherently noisy", not a v3 target                     |
| FTS, hot                          |   18 ms |   19 ms | vectorized MAXSCORE on a shared posting layout          |
| FTS, cold                         |  306 ms |  364 ms | statistics and postings fetched in one round trip       |
| count, hot                        |   22 ms |   23.5 ms | index statistics                                        |
| count, cold                       |   29 ms |   85 ms | index statistics, one round trip                        |
| filtered count, hot               |   22 ms |   23.5 ms | popcount of a filter bitmap                             |
| filtered count, cold              |  128 ms |  138 ms | bitmap built page by page                               |
| grouped count, 1,000 groups, hot  |  521 ms | 26,082 ms | hash map over contiguous columns, a page at a time      |
| order by attribute, filtered, hot |   22 ms |  218 ms | dynamic top-k filter skips rows in bulk                 |

Their datasets: Cohere Wikipedia 1024-d for vectors; MS MARCO v2.1 for text; synthetic documents with a
numeric `popularity` and 100 category values for order by; a string attribute with 1,000 values for grouped
count. They publish no filter selectivity, top_k, or sort direction; section 6 fixes ours.

Their hot numbers sit at ~20 ms because that is their floor (network, routing, query parsing), not their
engine. Their cold count of 29 ms means one object-storage round trip of roughly 15–25 ms on GCS. Both facts
shape the targets.

## 2. How the index stores and runs queries today

### Storage

A branch head (`store/head.rs`) is a small mutable object: the version hash and **hints**, a list of objects
the reader prefetches in parallel with the version (centroids, cluster table pages, the filter sample, filter
part directories, text hot parts, tail segments).

The `Version` (`format/mod.rs`, format 10) names:

- `tail`: segments written since the last build, each a postcard `Segment` of whole rows
  (`ids`, `vectors`, `attributes: Vec<BTreeMap<String, Value>>`, `deletes`).
- `built`: older segments, used only when the index has no vector column.
- `ann`: the vector index. Per vector column, IVF clusters of ~2,000 rows. Each cluster is one blob,
  `[header][codes][attributes][vectors]` (`format/cluster.rs`): RaBitQ codes and ids; the attributes
  section is a postcard `Attrs` holding, per attribute, a `Vec<Option<Value>>`, plus for string, bool, int
  and uuid attributes an inverted `value → rows` set (bitmap or row list); then full vectors.
- `ann.rows`: the row map, pages of `(id, seq, cluster per column)` hashed by id.
- `ann.filters`: a sample of rows' attributes, used to estimate filter selectivity.
- `ann.parts`: **filter parts**, one per `filter_index` attribute: every row sorted by that attribute, in
  1,024-row blocks that carry the value, the other filter-indexed attributes, and the row's RaBitQ codes per
  vector column, with a directory of each block's first value.
- `text`: Tantivy indexes ("parts") in blobs, each with a zstd "hot" blob of its small files.

The memory cache (`store/cache.rs`) is an LRU keyed by **content hash** of what it holds (a blob, or a named
section of one). An optional disk cache (`ChunkCache`) keeps whole blobs.

### Filters

`Attrs::eval` builds a bitmap per cluster. Equality, `In` and `ContainsAll` on keyed kinds OR the
precomputed sets: good. Ranges, `Exists`, and anything on a number or datetime fall back to `scan`, which calls
`Filter::test` on a boxed `Option<Value>` for every row. Ids filters test each id. Nothing is skipped at the
page level: there are no per-cluster min/max values, so every cluster's attributes are decoded.

### Count and aggregation

There is no count path. `Snapshot::aggregate` (`read/snapshot.rs`) calls `live::each`, which for every cluster
reads **codes and attributes** (the codes only to learn the ids), evaluates the filter, and for every passing
row builds a fresh `BTreeMap<String, Value>` of all its attributes (`attrs.row`), checks it against a
`HashMap` of tail ids, then postcard-encodes the group key and probes a `HashMap<Vec<u8>, _>`.

At 10M rows of Cohere-1024 that is 5,000 cluster reads of about 1.7 GB of codes plus the attributes, ~10M
`BTreeMap` allocations, ~10M tail-map probes and ~10M key encodings. Estimated, to be measured in phase 0:
several seconds hot for a count, 10–30 s for a grouped count (turbopuffer v2's 26 s is the same design), and
cold, ~80 waves of 64 GETs.

An index with **no vector column** is worse: `live::each` replays every built segment, row by row.

### Order by

`Snapshot::order` is the same scan: every passing row is materialized into the candidate list, which is sorted
and cut to `2 × top_k` whenever it doubles. The filter parts, already sorted by an attribute, are never used to
read in order.

### BM25

`text/search.rs`: Tantivy's block-max WAND (`for_each_pruning`) over each part, single-threaded per query,
with filters turned into Tantivy bitmaps first. A cold query takes 4 waves: head; version with the hinted hot
parts; term dictionary blocks; postings, then the stored documents of the hits. MS MARCO 8.8M: cold p90 353 ms
(60 ms store), hot p90 23.5 ms.

### Vector search

`read/query/mod.rs`: IVF with a calibrated probe count, RaBitQ estimates with error bounds, parallel across
cores, a shared top-k bound between threads, and a rerank that reads only the candidate vectors by byte range.
Selective filters go filter-first through a filter part. Filter selectivity is estimated from the sample.
Cold is 4 waves (head, version and directory, clusters, rerank). Cohere-10M on AWS: cold p50 411 / p99 621 ms,
warm p50 10.1 ms.

### Where each turbopuffer workload loses time today

| Workload             | Where the time goes                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| count                | no statistic; a full scan of codes and attributes                                               |
| filtered count       | the same scan; no page skipping; row-at-a-time `scan` for ranges                                |
| grouped count        | the scan, plus a row map, key encoding and hash probe per row                                   |
| order by, filtered   | the scan, plus materializing every passing row; sorted filter parts unused                      |
| FTS hot              | single-threaded WAND; no intra-query parallelism                                                |
| FTS cold             | 4 serial waves; the term dictionary wave depends on the hot part, postings on the dictionary    |
| vector hot / cold    | already ahead; filtered queries estimate selectivity from a sample, which mis-plans rare values |
| all, cold            | attributes ride inside vector blobs, so reading one attribute reads codes too                   |
| all, with a tail     | each built row probes a `HashMap` of tail ids to learn if it was replaced                       |

## 3. The design

The baseline we take as given (turbopuffer v3's): columnar struct-of-arrays pages; constant, dictionary,
run-length and frequency encodings with compute on compressed data; vectorized filters that build page
bitmaps; filters pushed into storage; a dynamic top-k filter for order by; hash grouped aggregation; one
batched round trip for a cold query.

What makes ours different is a single idea applied everywhere: **every page is immutable and
content-addressed, so everything we compute about a page can be computed once, stored or cached by its hash,
and reused by every query, version and branch that contains the page.** turbopuffer recomputes per query
what we look up.

### 3.1 Column parts

Attributes move out of the cluster blobs into **column parts**: one per attribute, independent of vectors.

- A **page** is a run of rows: for an index with vectors, one IVF cluster of the first vector column (so
  vector search and its filter bitmaps line up, row for row); without vectors, 8,192 rows in build order.
  Every column part has the same pages, so a row's position `(page, row)` is the same in every column.
- A column part is a set of large blobs (≤64 MiB, like filter parts) holding each page's **chunk**, plus a
  **column directory**: per page, the byte range, checksum, and **page statistics** (3.2).
- A page also has an **ids chunk** (sorted-run encoded ids) in its own part, so reading attributes never reads
  RaBitQ codes.

Chunk encodings, chosen per chunk at build time from the chunk itself:

| Encoding        | When                                    | Compute on it                                         |
| --------------- | --------------------------------------- | ----------------------------------------------------- |
| constant        | one value (or all missing)              | a predicate is one comparison for the whole page      |
| dictionary      | ≤ 64K distinct values in the column     | predicates run once per dictionary entry, then codes  |
| run-length      | average run ≥ 8                         | predicates and counts per run                         |
| frequency       | one value ≥ 90% of rows                 | the common value once, exceptions as a sparse list    |
| bit-packed int  | ints, timestamps (frame of reference)   | range predicates as integer compares on packed lanes  |
| plain           | floats, high-cardinality strings        | SIMD compares on f64 lanes; strings via offsets       |

Validity (missing values) is a separate bitmap per chunk, absent when the chunk has none.

Dictionaries are **global per column per build**, sorted by value, so a dictionary code is the same in every
page and its order is the value order. That makes three things cheap: group keys are small integers (3.5),
range predicates on strings become a code range, and pages merge without comparing values.

### 3.2 Page statistics: answer from metadata first

Each page's directory entry carries:

- row count, missing count;
- min and max (zone map), for every orderable kind;
- for dictionary columns of up to 4,096 values: the **value histogram** (code → count), sparse;
- for list kinds: the same over items;
- for others: a distinct-count sketch (HyperLogLog, 256 B) for the planner.

The column directory also carries the **column totals**: the merged histogram, global min/max, and counts.
These are what turbopuffer calls index statistics, but per page and per value, which lets us answer exactly:

| Query                                            | Answered from                          | Rows read |
| ------------------------------------------------ | -------------------------------------- | --------: |
| `count(*)`                                       | head line `rows N` (3.7)               |         0 |
| `count where category = 'x'`                     | column totals                          |         0 |
| `count where a = x and b in (…)`, independent    | pages: zone maps prune, histograms of fully-covered pages add, only partially-covered pages are scanned | few pages |
| `count group by s` (1,000 values)                | column totals                          |         0 |
| `count group by s where popularity > p`          | pages whose zone map is fully inside the range add their histogram; the rest scan | boundary pages |
| `min`/`max` of an attribute                      | column totals                          |         0 |

A page is **fully covered** by a predicate when its zone map or histogram proves every non-missing row
passes; then its contribution is its histogram (or its count), with no rows read. Only the pages a predicate
partially covers are decoded. With a clustering sort key (3.9), almost every page is fully in or fully out
for range predicates on that key.

### 3.3 Vectorized execution over pages

Execution is page-at-a-time over **selection bitmaps** (`[u64; rows/64]`), never row-at-a-time `Value`s.

- A predicate on a chunk produces a bitmap from the encoding directly: constant → all or nothing; dictionary
  → evaluate on the dictionary once, giving a code set, then a lookup per code (a 64-entry-wide SIMD gather
  for small dictionaries, or the precomputed inverted sets we already store); run-length → fill runs; packed
  ints → lane compares.
- `And`/`Or`/`Not` are word-wise on bitmaps, short-circuiting on all-zero or all-one pages known from stats.
- Kernels are written as plain loops over fixed-width lanes that LLVM auto-vectorizes, with `std::arch`
  versions (AVX2, AVX-512, NEON) for the four hottest: dictionary-code gather, packed compare, popcount over
  a masked range, and dense-group counting. Each kernel has a scalar reference and a property test against it.
- Pages run in parallel across cores (a work-stealing pool of pages, like the vector path's `parallel`).

### 3.4 Deletes and replaced rows as page bitmaps

Today every built row probes a hash map of tail ids. Instead, the tail's ids are looked up **once** in the
row map (which already maps id → cluster) and turned into a per-page **dead bitmap**, cached by
`(page hash, tail hash)`. A query ANDs it in like any predicate; pages with none skip the step. Cost moves
from O(rows) to O(tail).

### 3.5 Grouped aggregation

Group keys over dictionary columns are codes, so groups are a **dense array** indexed by code (or by the
mixed-radix code of several columns while the product stays ≤ 1M), not a hash map: one add per passing row,
no hashing, no key copies, and per-thread arrays merged at the end. Hash maps remain for high-cardinality or
non-dictionary keys, keyed by the code tuple. `sum`/`avg`/`min`/`max` run on the decoded lanes of only the
pages that pass, and fully-covered pages take their precomputed per-page sums and extremes.

### 3.6 Order by: visit pages in value order, stop early

For `order by a [asc|desc] limit k [where …]`:

1. Rank pages by their zone map's best bound for `a` (min for ascending).
2. Keep a top-k heap; its kth value is the **dynamic filter**. Visit pages in rank order; a page whose best
   bound cannot beat the kth value ends the scan, since every later page is worse.
3. Within a page, the dynamic filter is one more predicate on `a`, ANDed with the query's filter bitmap and
   the dead bitmap, so only rows that could enter the top k are even compared.
4. **Late materialization**: the heap holds `(value, page, row)`; only the final k rows read the `include`d
   columns, in one batched read.

When `a` is filter-indexed, its filter part is already a sorted projection: read its blocks from the right
end and stop at k. With 100 categories and k = 10, a filtered order by reads about one block.

### 3.7 Cold queries: one wave after the head

The head object is read first by every query and is small. It grows a few lines:

- `rows N`: the live row count of the version, kept exact by the writer and builder (3.10). Cold count is
  then the head alone: one round trip.
- `columns <hash>`: one object holding every column directory's **totals** (3.2), so a filtered or grouped
  count, and the planner's statistics, arrive in the same wave as the version.

The reader then plans the whole query against the version and these statistics and issues every read it
will need **as one wave**: column chunks of the pages that survive zone-map pruning, dead-bitmap row-map pages,
ids chunks, and for vector queries the cluster sections. Reads to the same blob within 256 KiB coalesce into
one range request, as filter parts already do. Speculation is bounded: the planner fetches the pages it
predicts with statistics, and a second wave happens only when a prediction was wrong (e.g. a filtered top-k
that ran out of matches).

Target waves per cold query: count 1; filtered or grouped count 2; order by 2–3; vector 3; FTS 3.

### 3.8 A cost-based planner with exact statistics

Today the vector path picks filter-first or vector-first from a row sample, which misjudges rare values.
The planner uses the column totals and page histograms, which are exact for dictionary columns and tight for
the rest, to choose per query:

- filter-first (through a filter part or page bitmaps) or vector-first, and the probe count given the
  filter's share;
- metadata-only, page-skip, or full scan for counts and aggregates;
- filter part, zone-map order, or heap scan for order by;
- which filter clause to evaluate first (most selective, cheapest encoding).

Plans are deterministic given the version, so they are cached by `(version, query shape)`.

### 3.9 Adaptive layout from observed queries

Each index keeps a small, bounded log of query shapes (attribute names and operators, never values). At build
time the builder uses it to choose:

- a **clustering key** for indexes without vectors: rows sorted by the most range-filtered or ordered
  attribute, which makes its zone maps disjoint, so range filters, filtered counts and order by touch only
  boundary pages;
- which attributes get **sorted projections** (filter parts) automatically, instead of only those named in
  `filter_index`;
- a dictionary for a string column that is grouped often even past 64K values.

Encodings themselves are chosen from the data per chunk (3.1), which needs no query history.

### 3.10 Caching that forks share, and partial results that persist

Our caches are keyed by content hash, so a fork reads its parent's pages from the same cache entries with no
extra work: an edge turbopuffer, which keys by namespace, does not have. v2 builds on it:

- **Decoded pages** are cached by `(chunk hash, encoding)`: a fork, and every later version that kept the
  page, hits them.
- **Partial results** are cached by `(page hash, normalized predicate)`: a page's filter bitmap, and for
  aggregates its partial tally. A repeated dashboard query on a version that changed 1% of its pages
  recomputes 1% of the work. Across a fork and its parent, it recomputes only where they differ. Bounded by
  the same LRU budget; a partial is kept only when it took longer to compute than its size suggests to keep.
- **Warm sets follow forks**: `warm()` on a fork prefetches only the pages its parent's cache does not
  already hold.

The live row count in the head is maintained incrementally: a build knows its exact count; a tail segment
adds its new ids and subtracts its deletes after a row-map lookup for its ids, which the writer does in
the same group commit (that lookup is O(segment) and cached).

### 3.11 Text and vectors on the same pages

- **Filtered FTS and filtered vector search** take their filter bitmaps from 3.3, by page, instead of
  Tantivy fast fields or `Attrs::eval` on whole cluster attribute sections.
- **FTS hot**: score parts in parallel and split large parts into doc-id ranges scored on separate cores, with
  a shared threshold, as the vector path already does across clusters. Replace the per-document `allowed`
  closure (two hash-set probes) with the page dead bitmap.
- **FTS cold**: the hot part grows a **term index**: terms hashed into 4,096 buckets, each bucket's byte
  range in the term dictionary. A query computes its buckets locally and fetches the dictionary blocks in
  the same wave as the hot part, cutting a wave (4 → 3). The stored fields of a part's highest-impact
  documents are kept beside their postings, so most top-k hits need no separate document fetch.
- **Vector**: SIMD RaBitQ scoring (the popcount and plane sums are the inner loop today, auto-vectorized
  at best), and exact filter selectivity from 3.8.

### 3.12 What we chose not to do

- **Replacing Tantivy** with our own posting format and MAXSCORE engine. It would let us match their shared
  layout, but our gap on FTS is 5 ms hot and one wave cold, both closable above. Revisit if phase 6 misses.
- **Moving vector clusters to a new format.** Vector search is already 2× ahead cold; v2 only moves
  attributes out of cluster blobs.
- **A general SQL planner.** The planner covers our query APIs (`query`, `search`, `order`, `rank`,
  `aggregate`, and a new `count`), nothing wider.

## 4. API additions

- `Snapshot::count(filter: Option<Filter>) -> u64` and `Index::count`. Today a count is an aggregate.
- `Aggregate` and `Order` are unchanged; their implementations move to the engine.
- `Stats` reads `rows` from the head when it can.

No change to SDKs or `apps/www`.

## 5. Migration with no downtime

1. **Format 11** adds `Version.columns: Option<Columns>` (column part directories and totals) and the new
   head lines. Format 10 versions keep reading through today's paths; the engine runs when `columns` is
   present. `decode_version` already reads older formats.
2. **Backfill without re-clustering**: a new build step reads each cluster's attributes section once and
   writes column parts with the same pages. It runs from the existing background builder as a normal
   version change (`Storage::save`, compare-and-swap on the head), so readers and writers never stop; a
   concurrent write simply lands in the tail and is covered next build.
3. **Both representations coexist** for one release: cluster blobs keep their attributes section, so a
   rollback to a reader that ignores `columns` is safe. A later format drops the section from newly written
   clusters.
4. **History and GC** (`history/gc.rs`) learn the new hashes (column blobs, directories, totals) before any
   version names them, so GC never deletes a live page.
5. **Every step is checked by an oracle**: a test helper runs each query through both paths on random data,
   filters, deletes and tails, and asserts identical results. The legacy path stays as that oracle.

## 6. Benchmark plan and targets

### Workloads

Phase 0 adds them to `index-bench` (or adopts them from the proposed `tpuf-v3-bench` session if it has
started; it has not as of writing):

- `attrs` dataset: 10M rows, `popularity` (float, Zipf), `category` (string, 100 values), `group` (string,
  1,000 values), `created` (timestamp), with and without a 1024-d vector column.
- **count**: no filter. **filtered count**: `category = c` (1%) and `category = c and popularity > p` (~0.1%).
- **grouped count**: `count group by group`, 1,000 groups, unfiltered and with `popularity > p` (10%).
- **order by**: `popularity desc limit 10`, unfiltered and `where category = c`.
- **vector**: Cohere-10M as published today; **FTS**: MS MARCO 8.8M as today.
- Load: open-loop 8 QPS for 10 minutes (shortened with `--quick` for development), reporting p50, p90, p99,
  waves per query and bytes read. Hot: after a warm pass reaches 100% memory hits. Cold: a fresh `Storage`
  with no caches per query.

### Cold comparisons need a fair store

The slow store adds **60 ms per request**, about three times a GCS or S3 first-byte latency in region. Every
cold turbopuffer number includes their own round trips at their latency. One wave on our slow store already
costs 60 ms, so count cold (29 ms) can never be met there, however good the engine. We will report every cold
result in **waves** and at two latencies: the slow store's 60 ms, and **20 ms**, the latency the filesystem
benchmarks already use for in-region object storage. Targets for cold are stated at 20 ms and in waves.

### Targets (p90)

| Workload                          | turbopuffer v3 | Today (est., phase 0 measures) | Target, hot / cold @20 ms | Why it is reachable                       |
| --------------------------------- | -------------: | -----------------------------: | ------------------------: | ----------------------------------------- |
| count, hot                        |          22 ms |                          > 1 s |                  < 0.1 ms | head line                                 |
| count, cold                       |          29 ms |               ~80 waves, > 5 s |           1 wave, < 25 ms | head line                                 |
| filtered count, hot               |          22 ms |                          > 1 s |                    < 2 ms | totals and page histograms                |
| filtered count, cold              |         128 ms |              ~80 waves         |          2 waves, < 50 ms | totals in the version wave                |
| grouped count, 1,000 groups, hot  |         521 ms |                       10–30 s  | < 1 ms unfiltered, < 25 ms filtered | totals; dense code arrays       |
| order by, filtered, hot           |          22 ms |                          > 1 s |                    < 5 ms | zone-map order, dynamic filter, projection |
| order by, unfiltered, hot         |          22 ms |                          > 1 s |                    < 2 ms | the same                                  |
| vector, hot                       |          20 ms |              p50 10.1 ms (AWS) |                   < 15 ms | already; SIMD and exact selectivity       |
| vector, cold                      |       1,255 ms |              p99 621 ms (AWS)  |                  < 600 ms | already                                   |
| FTS, hot                          |          18 ms |                        23.5 ms |                   < 15 ms | parallel scoring, dead bitmaps            |
| FTS, cold                         |         306 ms |  353 ms @60 ms, 4 waves        |    3 waves, < 250 ms @60 ms | term index cuts a wave                  |

A target is met when its p90 beats turbopuffer's at the stated latency, in two runs.

## 7. Phases

Each phase ends with `cargo test`, clippy (`-D warnings`) and fmt clean, an `index-bench` run on the slow
store (and at 20 ms for cold), the numbers added to a results table in this doc, and a commit on `engine-v2`.

| Phase | Work                                                                                          | Workloads it moves                   |
| ----: | --------------------------------------------------------------------------------------------- | ------------------------------------ |
|     0 | `index-bench` workloads, open-loop load, waves; baseline today                                 | all (measured)                       |
|     1 | column parts, encodings, page statistics, column totals, format 11, backfill, GC, oracle tests  | none yet; storage only              |
|     2 | vectorized filters on pages, dead bitmaps, `count`, aggregation engine, head `rows`, planner v1 | count, filtered count, grouped count |
|     3 | order by: zone-map order, dynamic filter, projections, late materialization                    | order by                             |
|     4 | cold path: head and totals lines, one-wave planned prefetch, partial-result cache               | all cold                             |
|     5 | filtered vector search on page bitmaps, exact selectivity, SIMD RaBitQ                          | vector                               |
|     6 | FTS: parallel scoring, dead bitmaps, term index                                                 | FTS                                  |
|     7 | adaptive layout: query-shape log, clustering key, automatic projections                         | everything with ranges, order by     |

Phases 2–3 alone pass five of the ten rows. Phase 6 is the riskiest: if parallel Tantivy scoring does not
reach 15 ms hot, the fallback is our own block-max MAXSCORE over Tantivy's postings for the two-to-four-term
queries that dominate MS MARCO.

## 8. Decisions for approval

1. Cold targets at **20 ms per request** and in waves, as well as at the slow store's 60 ms.
2. Our own dataset shapes and selectivities in section 6, since turbopuffer publishes none.
3. Column parts keyed to IVF clusters for vector indexes (row alignment with vector search) rather than an
   independent sort order; sorted projections cover the order-by cases.
4. Keeping Tantivy for FTS (3.12).
5. Phase order as in section 7.
