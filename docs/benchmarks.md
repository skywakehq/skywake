# Published benchmark numbers

Every number Skywake publishes, where it came from and how to make it again. How the benchmarks work, and what
each metric means exactly, is in [benchmarks/README.md](../benchmarks/README.md).

The full report of each run cited here is in [benchmarks/published/](../benchmarks/published/), named by the
run's date. All of them ran on pre-release code, several with uncommitted changes, so no single commit
reproduces them exactly; the commands below make fresh numbers from the current code.

## Filesystem on AWS

Runs of November 6, 2026: [store, save, daemon](../benchmarks/published/20261106-075558.md) and
[mount, fleet](../benchmarks/published/20261106-081136.md).

|          |                                                                                           |
| -------- | ----------------------------------------------------------------------------------------- |
| machine  | AWS m7i-flex.large: 2 vCPUs (Xeon Platinum 8488C), 8 GB, Linux 6.18                       |
| store    | Amazon object storage in ap-southeast-2, the same region as the machine; no added latency |
| settings | full datasets; random data, so nothing dedupes                                            |

| Operation                                                    |                            Result |
| ------------------------------------------------------------ | --------------------------------: |
| commit, 1,074 MB in 10,139 files (90% large binaries)        |                   6.4 s, 168 MB/s |
| the same with `aws s3 cp --recursive`                        |                   28.7 s, 37 MB/s |
| commit, nothing changed                                      |                            172 ms |
| checkout, the same 1,074 MB                                  |                   3.5 s, 311 MB/s |
| fork (`new --from`), median of 100                           |     95 ms (mixed), 91 ms (source) |
| commit, 101 MB in 20,000 small files                         |                    4.7 s, 22 MB/s |
| save after rewriting one small file, mounted                 |                             93 ms |
| `kill -9` while writing every 20 ms: oldest lost write       | 2,032 ms (the save window is 2 s) |
| restart the daemon and mount again                           |                            124 ms |
| move a branch to another machine (unmount, mount)            |                            166 ms |
| take over a branch still mounted elsewhere                   |                             79 ms |
| mount 20 forks at once                                       |                            311 ms |
| daemon memory with 20 mounts                                 |                            200 MB |
| `git status` in a mounted fork, warm / local disk            |                   9.1 ms / 2.9 ms |
| `cargo build` and tests in a mounted fork, warm / local disk |                   85.0 s / 84.5 s |

"300× faster than copying 1 GB" is the fork against `aws s3 cp`: 28.7 s ÷ 95 ms ≈ 300.

```bash
INSTANCE=m7i-flex.large AWS_REGION=ap-southeast-2 benchmarks/cloud/aws/run.sh plan   # then: up, status, fetch, down
```

`run.sh` defaults to an i4i.4xlarge in us-west-2; the two settings above repeat this machine and region.

## Filesystem, shared reads

[Run of November 5, 2026](../benchmarks/published/20261105-135037.md): a 6-CPU Linux VM with 8 GB, the local
object storage with 20 ms added to every request, full datasets.

Twenty agents reading every file of one 278 MB tree at once, through one daemon's chunk cache, made 1,009 GETs
for 999 chunks: each chunk left the bucket about once.

```bash
scripts/bench.sh filesystem fleet --s3-latency-ms 20
```

## Filesystem on a laptop

Runs of November 5, 2026 for the
[store](../benchmarks/published/20261105-155907.md), the [mount](../benchmarks/published/20261105-121157-mount.md)
and the [daemon](../benchmarks/published/20261105-125604-daemon.md), on a 10-core laptop against the local object
storage with no added latency; the mount and daemon suites in the Linux dev VM.

| Operation                                         |   Time | Throughput |
| ------------------------------------------------- | -----: | ---------: |
| `aws s3 cp --recursive`, 1,074 MB in 10,018 files | 23.8 s |    45 MB/s |
| `skywake commit`                                  | 13.9 s |    77 MB/s |
| `skywake commit`, nothing changed                 | 119 ms |            |
| `skywake checkout`                                |  4.4 s |   243 MB/s |
| fork (`new --from`), mean of 100                  |  15 ms |            |

```bash
scripts/bench.sh filesystem store
```

## Vector index on AWS

Runs of November 10, 2026: an i4i.4xlarge in ap-southeast-2 against a bucket in the same region. Reports:
[SIFT-1M](../benchmarks/published/20261110-index-sift-1m.md),
[Cohere-1M](../benchmarks/published/20261110-index-cohere-1m.md),
[Cohere-10M](../benchmarks/published/20261110-index-cohere-10m.md). _Warm_ below keeps the index head in
memory and its clusters on local disk (`warm+disk+head` in the reports).

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
