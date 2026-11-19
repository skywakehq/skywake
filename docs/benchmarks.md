# Published benchmark numbers

Every number Skywake publishes, where it came from and how to make it again. How the benchmarks work, and what
each metric means exactly, is in [benchmarks/README.md](../benchmarks/README.md).

The full report of each run cited here is in [benchmarks/published/](../benchmarks/published/), named by the
run's date. All of them ran on pre-release code, several with uncommitted changes, so no single commit
reproduces them exactly; the commands below make fresh numbers from the current code.

## Vector index on AWS

Runs of November 10, 2026: an i4i.4xlarge in ap-southeast-2 against a bucket in the same region. Reports:
[SIFT-1M](../benchmarks/published/20261110-index-sift-1m.md),
[Cohere-1M](../benchmarks/published/20261110-index-cohere-1m.md),
[Cohere-10M](../benchmarks/published/20261110-index-cohere-10m.md). _Warm_ below keeps the index head in
memory and its clusters on local disk (`warm+disk+head` in the reports). These runs time the index inside the
benchmark's process, so they leave out the API, HTTP and JSON a client goes through; `index-bench api` measures
that path.

| Set                           | Result                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Cohere-10M (10M × 768)        | cold p50 411 ms (p99 621 ms, recall 0.95), 387 ms at 1% (recall 0.968); warm p50 10.1 ms |
| Cohere-10M, load and build    | 5 min 35 s to load (8 writers), 22 min 32 s to build                                     |
| Cohere-1M (1M × 768)          | cold p50 153 ms, warm p50 2.8 ms (26 ms reading the head), recall 0.96                   |
| SIFT-1M (1M × 128)            | cold p50 127 ms, warm p50 2.1 ms (25 ms reading the head)                                |
| SIFT-1M, waves per cold query | 4, unfiltered and at every filter down to 0.1%                                           |

```bash
benchmarks/cloud/aws/run.sh plan   # AWS_REGION=ap-southeast-2 for the same region
```

## Vector index on the slow store

Measured during development on the slow store: 60 ms before every request, at most 64 in flight. These runs
kept no report file; the commands below repeat them.

| Set                                         | Result                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| SIFT-1M (1M × 128), cold p50                | 259 ms unfiltered, 267 ms at a 1% filter, 318 ms at 0.1% (recall 0.966) |
| SIFT-1M, warm p50, local store / slow store | 1.5 ms / 129 ms                                                         |
| SIFT-1M, filtered recall@10 at 1%           | 0.98                                                                    |
| Cohere-10M (10M × 768), cold p50            | 306 ms unfiltered (recall 0.94), 551 ms at 1%                           |
| Cohere-10M, repeat queries, p50             | 261 ms unfiltered, 339 ms at 1%                                         |

```bash
cargo build --release -p skywake-benchmarks
uv run --script benchmarks/datasets/fetch.py get sift-1m
target/release/index-bench run benchmarks/datasets/data/sift-1m --store slow
```

## Text index (BM25)

MS MARCO passages, measured during development: cold on the slow store (60 ms, 64 in flight), warm on the local
store. These runs kept no report file either.

| Set                                   | Result                                                   |
| ------------------------------------- | -------------------------------------------------------- |
| 1M passages                           | cold p50 275 ms in 4 waves, 3.5 MB read; warm p50 1.7 ms |
| 8.8M passages, 100 dev queries cold   | p50 315 / p90 353 / p99 400 ms, 4 waves for every query  |
| 8.8M passages, 1,000 dev queries warm | p50 5.5 / p90 23.5 / p99 56.5 ms                         |
| 8.8M, k1 0.9, b 0.4                   | dev MRR@10 0.1836, DL19 nDCG@10 0.5064                   |

```bash
uv run --script benchmarks/datasets/fetch.py get msmarco
target/release/index-bench msmarco benchmarks/datasets/data/msmarco --store slow
```

## Pinned indexes

[Run of November 9, 2026](../benchmarks/published/20261109-pinning.md), on a MacBook Pro (three API servers
sharing its cores), the dev Postgres and local object storage. 100,000 rows × 64 dimensions, 48 clients, 20 s
per phase.

| Phase              |   QPS | p50 ms | p99 ms | Errors | Temperature           |
| ------------------ | ----: | -----: | -----: | -----: | --------------------- |
| unpinned           | 2,209 |   18.9 |   61.4 |      0 | cold 157, warm 44,021 |
| pinned, 1 replica  | 1,841 |   24.5 |   52.1 |      0 | warm 36,828           |
| pinned, 3 replicas | 2,294 |   18.6 |   56.4 |      0 | warm 45,885           |

That run's load generator was a TypeScript script; `pinning-load` is the same load in Rust, with the same
rows, phases and percentiles but seeded noise in the vectors, so its client costs differ a little.

```bash
scripts/bench.sh pinning
```
