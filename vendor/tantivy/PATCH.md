# Tantivy 0.27.0, patched: BM25's k1 and b per query

This is Tantivy 0.27.0 from crates.io (MIT, see `LICENSE`) with two small
changes. Skywake uses it through `[patch.crates-io]` in the root
`Cargo.toml`. The text below is also the proposal we would send upstream.

## Why

Tantivy fixes BM25's `k1 = 1.2` and `b = 0.75` as private constants.
Good values depend on the corpus: MS MARCO passages, for example, score
best at `k1 = 0.9, b = 0.4` (Pyserini's tuned run). Users of a search
service expect to set them per index, and to try other values per query
without building the index again.

The constants are also baked into the index: each postings block stores
the `(fieldnorm id, term frequency)` pair that scores best under
`k1 = 1.2, b = 0.75`, and block-max WAND prunes with it. Under other
values that pair is no longer the block's best, so pruning could drop
documents that belong in the top k.

## Change 1: the block-max pair is the block's corner

`src/postings/serializer.rs` now stores, per block, the shortest field
length (smallest fieldnorm id) and the largest term frequency, which may
come from different documents.

BM25's term score rises with the term frequency and falls with the
field length, for every `k1 ≥ 0`, `0 ≤ b ≤ 1` and average length. So the
corner pair bounds every document of the block under any parameters.

- The format does not change: it is the same two numbers in the same
  place. Indexes written before the patch still read; their pairs are
  exact for the defaults, as before.
- The bound is a little looser than the old one under the defaults, so
  pruning skips a little less.

## Change 2: `Bm25StatisticsProvider::bm25_params`

`src/query/bm25.rs`:

- `K1` and `B` are public.
- The trait gets a provided method, `fn bm25_params(&self) -> (Score, Score)`,
  returning `(K1, B)`. Existing providers keep working.
- `Bm25Weight` holds its `k1` and `b`. `Bm25Weight::for_terms` takes them
  from the provider, and `Bm25Weight::with_params(k1, b)` changes them on
  an existing weight. `explain` prints the values actually used.

A query that wants other values passes a statistics provider to
`EnableScoring::enabled_from_statistics_provider` that returns them.
Because of change 1, `for_each_pruning` stays exact.

## Tests

Skywake's `crates/index/src/text/tests.rs` scores against a brute-force
BM25 oracle at `(1.2, 0.75)`, `(0.9, 0.4)`, `(2, 1)` and `(0.5, 0)`, with
pruning on, and checks that the top k is the same.
