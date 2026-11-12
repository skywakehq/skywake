# Benchmarks

Skywake's benchmarks come in two kinds:

- **Microbenchmarks** live next to the code they measure, as Criterion benches in `crates/core`,
  `crates/index` and `crates/cache`. They time one function on in-memory data and need nothing else.
- **System benchmarks** live here. They run Skywake as a whole against object storage and save every number to
  one results format.

`scripts/bench.sh` runs either kind; `--quick` runs it small, to check a change in a few minutes.

```bash
scripts/bench.sh micro --quick          # Criterion: hashing, packs, trees, RaBitQ, filters, BM25, the chunk cache
scripts/bench.sh index --quick          # the vector index on a 5,000-row synthetic set
scripts/bench.sh filesystem --quick     # the filesystem suites, in the Linux container unless on Linux
scripts/bench.sh pinning --quick        # pinned indexes through three API servers
scripts/bench.sh scale --quick          # filesystems of growing size, and how each cost grows
scripts/compare-benchmarks.sh           # the last two runs of one benchmark, side by side
```

The numbers we publish, and how each was made, are in [docs/benchmarks.md](../docs/benchmarks.md).

## Layout

```text
benchmarks/
  Cargo.toml          skywake-benchmarks: the Rust harness and its four binaries
  src/
    bin/              index-bench, s3-proxy, pinning-load, scale-bench: argument parsing only
    datasets/         dataset files, the synthetic generator, filters, brute-force ground truth
    environment.rs    commit, dirty flag, machine
    metrics/          percentiles, request counting, waves, peak memory
    proxy/            the counting proxy in front of object storage
    results.rs        the results format, saved to results/<run>/
    stores/           local, slow (added latency) and s3:// stores, every request logged
    workloads/        vectors (recall and latency), text (BM25 on MS MARCO), pinning (load through the API),
                      scale (filesystem costs at growing sizes)
  schema.py           the same results format, for the Python harnesses
  compare.py          two runs side by side, every number more than 10% worse marked
  filesystem/         the filesystem suites (Python): run.py, the suites, lib.py, report.py
  datasets/fetch.py   downloads and converts the public datasets into datasets/data/
  pinning/run.sh      starts three API servers and runs pinning-load through them
  cloud/aws/          the full run on an AWS machine and bucket
  cloud/r2/           the filesystem suites on Cloudflare R2
  results/            every run's results.json and report.md (git ignores it)
```

Git ignores `results/`, `datasets/data/` and `cloud/r2/r2.env`. Results that matter go into
[docs/benchmarks.md](../docs/benchmarks.md) with how they were made; git history keeps the older ones.

## Microbenchmarks

| Crate   | Group           | What it times                                                                     |
| ------- | --------------- | --------------------------------------------------------------------------------- |
| `core`  | `hash`          | BLAKE3 of a 4 KiB, 64 KiB and 1 MiB chunk                                         |
| `core`  | `tree`          | addressing, encoding and decoding a 1,000-entry directory tree                    |
| `core`  | `pack`          | laying out a pack of new chunks                                                   |
| `index` | `rabitq`        | encoding 1,000 rows and scoring a cluster                                         |
| `index` | `filter/lookup` | lookups in a filter part: equality, range, `in`                                   |
| `index` | `bm25`          | a warm BM25 search held in memory                                                 |
| `cache` | `chunk`         | a 64 KiB read that hits the chunk cache, and one served by a cache node over HTTP |

Each crate runs on its own: `cargo bench -p skywake-core`, `cargo bench -p skywake-index --features bench`,
`cargo bench -p skywake-cache`. The index bench needs the `bench` feature, which exposes a few internals to it
and nothing else. Criterion keeps its own history in `target/criterion/` and says how each run moved against
the last one; `-- --save-baseline main` and `-- --baseline main` compare against a named one.

## Results

Every system benchmark saves `results/<run>/results.json` and `report.md`, where `<run>` is
`<date>-<time>-<benchmark>`; `--out DIR` saves somewhere else. `results.json` is the same for every benchmark:

```json
{
  "schema": 1,
  "benchmark": "index",
  "run": "20261109-193535-index",
  "environment": {
    "commit": "7605929",
    "dirty": false,
    "started": "2026-11-09T19:35:35Z",
    "machine": { "hostname": "…", "os": "…", "kernel": "…", "arch": "aarch64", "cpu": "…", "cores": 10, "memory_bytes": 17179869184 },
    "client": "where the machine runs, for a remote bucket"
  },
  "settings": { "everything that changes the numbers: seed, rows, payload sizes, concurrency, store and its latency" },
  "tables": [{ "name": "queries", "rows": [{ "label": "…", "metrics": { "p50_ms": 1.2 } }] }]
}
```

A number from a repeated run is `{ "median", "min", "p95", "samples" }`. `compare.py` reads any two runs of
the same benchmark, lists every difference in environment and settings first, then marks each number that got
more than 10% worse: times, requests, bytes and waves are better lower; rates, QPS, recall, MRR and NDCG
better higher. Differences under 2 ms, 2 requests or 0.1 MB are noise and never marked.

Runs from uncommitted code say so: `dirty` is true and the filesystem report says it at the top.

## What the numbers mean

- **Requests and bytes.** Every request to the store is logged with its operation, bytes up and down, start and
  end. For the index, the store wrapper logs them; for the filesystem, the daemon talks to the bucket through
  `s3-proxy`, which passes every request through unchanged and reports it. The proxy streams bodies as they
  arrive and costs nothing measurable: checkouts ran at 340–510 MB/s through it and 380–420 MB/s without.
- **Waves.** One wave is one dependent round trip to the store. Requests are taken in start order; one joins
  the current wave if it started before any request of that wave ended, and starts a new wave otherwise. A
  request queued behind the limit on requests in flight starts a new wave too, since it costs one round trip
  of time. Waves only mean something with latency: the slow store or a real bucket.
- **Percentiles.** Each harness keeps the definition its numbers were first published with:
  - index queries: the sample at index ⌊n·p⌋ of the sorted times;
  - BM25 on MS MARCO: nearest rank, index ⌈n·p⌉ − 1;
  - pinning: index ⌊p·(n − 1)⌋, rounded to 0.1 ms;
  - filesystem: p95 is index round(0.95·(n − 1)) of the sorted runs, and the median is the usual one.
- **Cold and warm.** For the index, _cold_ opens a new handle per query, so nothing is cached in memory (the
  OS file cache still is, for `local`), and _warm_ runs the query set twice on one handle and times the second.
  With `--disk-cache` (sized by `--disk-cache-gb`, 10 by default), _warm+disk_ adds a chunk cache on disk and
  still reads the branch head every query; _warm+disk+head_ keeps the head while it holds a read lease, as the
  API does, so a warm query makes no request at all.
  For the filesystem, _cold_ is a fresh daemon with an empty chunk cache, _warm_ the same command again and
  _local_ the same files on the container's disk.
- **Memory** is the process's peak resident set.

## Seeds and datasets

Every dataset is generated from a seed, so the same settings make the same data:

- `index-bench gen` makes the synthetic vector set from seeds 42 (cluster centers), 1 (rows) and 2 (queries).
- The filesystem suites make their files from `--seed` (1), random contents included, so nothing dedupes
  against an earlier run's bucket.
- `pinning-load` makes rows from `--seed` (1) and queries from the seed after it.

The public sets come from `benchmarks/datasets/fetch.py` (`list` shows them; `get sift-1m` downloads one),
which writes the same `dataset.json` as `gen`: where the set came from, its rows, dimensions and metric. Ground
truth for filtered runs and for `--rows` limits is found by brute force once and saved in the dataset folder.

## The vector and text index

```bash
cargo build --release -p skywake-benchmarks
target/release/index-bench gen benchmarks/datasets/data/synth --rows 200000 --dims 768
uv run --script benchmarks/datasets/fetch.py get sift-1m
target/release/index-bench run benchmarks/datasets/data/sift-1m --store slow
uv run --script benchmarks/datasets/fetch.py get msmarco
target/release/index-bench msmarco benchmarks/datasets/data/msmarco --store slow
```

`run` loads the set into a fresh index, builds it, and reports recall@k; cold and warm p50, p90 and p99; per
query the requests, bytes read and waves; and load time, build time, write-to-visible latency and peak memory.
Every row gets a `tag` attribute (a hash of its id, 0–999), and filtered passes let 50%, 10%, 1% and 0.1% of
rows through. `msmarco` does the same for BM25: MRR@10 and NDCG@10 on the judged queries, then warm and cold
latency.

`--store local` is a temp folder; `slow` adds 60 ms before every request with at most 64 in flight, to act
like object storage; `s3://bucket/folder` uses the `AWS_*` settings and refuses a non-local endpoint unless
`--allow-remote`.

Loading runs `--writers` (8) upserts at once, which the index groups into commits. While it runs, `run` writes
one line per step to stderr: when each step starts and ends, how far a load has got with its rate and time
left, the bucket traffic of a build every half minute, and each pass's p50, p99 and recall. With `--out`, the
same events go to `events.jsonl` there, one JSON object per line, for a script or an agent to follow.

## The filesystem suites

```bash
scripts/bench.sh filesystem --quick                    # every suite, small datasets
scripts/bench.sh filesystem save daemon --quick        # only these
benchmarks/filesystem/run.py --help                    # inside the container, or on Linux with FUSE
```

They run in the Linux dev container, because the mount needs FUSE. Every suite runs five times (`--repeat`),
so a full run takes about 100 minutes and `--quick` about 25. A run refuses a tree with uncommitted changes
unless `--allow-dirty`. A full run needs several GB of scratch space in the temp folder; where `/tmp` is in
memory, point `TMPDIR` at a disk.

The local object storage answers in well under a millisecond; real object storage takes 10–30 ms per
request. `--s3-latency-ms 20` holds every request that long, to show which operations wait on requests one
after another and which overlap them.

| Suite    | What it measures                                                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store`  | `skywake commit`, `checkout` and fork, with no mount: a 1 GB project with build artifacts and a 20,000-file source tree. Includes `aws s3 cp` as the baseline for upload speed.                                                               |
| `mount`  | What an agent does in a mounted fork, against the same files on local disk: `git status`, `find`, reading and searching every file, unpacking 2,000 files, a 256 MB write, `cargo build` and `npm ci`. Reads run cold (empty cache) and warm. |
| `save`   | One save of a mount, for one kind of change at a time: a small edit, an append, 100 or 1,000 new files, a 64 MB file, deletes, a rename.                                                                                                      |
| `daemon` | `kill -9` with an agent writing, moving a branch between two daemons, taking one over while it is still mounted, and whether an idle mount costs anything.                                                                                    |
| `fleet`  | Twenty forks on one daemon: mounting them at once, all reading the same data (each chunk should leave the bucket once), all writing (how long until each is saved), and the daemon's memory.                                                  |

Each suite also checks the targets in [ROADMAP.md](../ROADMAP.md) and prints PASS or FAIL for each; a check
passes only if it passed in every run. Each number is the median of the runs, with the fastest and the 95th
percentile beside it: `11 (9 – 30)`. A wide spread means the machine or the network was noisy.

To add a suite, write a module in `filesystem/suites/` with a `run(ctx)` that returns a `Suite`: rows of
numbers, pass/fail checks and the settings that shaped it. `lib.py` has what suites share: `Daemon` to mount
with, `timed`, the datasets and `ctx.requests()` to count the requests a block makes. Add it to `SUITES` in
`run.py`.

## Filesystem scale

`scale-bench run` writes filesystems of growing size and measures the same operations on each: opening the
root (what a mount does), reading the deepest file, committing with nothing or one file changed, forking, and
a dry-run garbage collection in a process of its own, so its peak memory is its own. Then it reports how each
cost grows with size, as an exponent: 0 stays flat, 1 grows as fast as the filesystem. Operations must stay
flat; garbage collection may grow with the filesystem in time, and its memory must stay under 64 MiB.

Each filesystem is synthetic: real trees, commits and chunk objects, with tiny bodies. These costs depend on
the number of objects, not their bytes, so a step of `--files N` stands for N MiB of real data at the price
of N small writes. `--files` (1,000, 10,000 and 100,000) picks the steps, `--per-folder` (100) the shape,
`--history` (20) the commits after the first, and `--store` local, slow or `s3://` as for `index-bench`.
A local store counts a listing as one request; on S3 it is one per 1,000 keys.

## Pinned indexes

`pinning/run.sh` starts three API servers, each with its own disk cache as a pod would have, loads one index
through them with `pinning-load`, then queries it through all three at once: unpinned, pinned to one replica,
and pinned to three. It reports queries per second, p50 and p99 latency, which server answered each query and
how warm it was. The index and the caches are deleted at the end.

`scripts/bench.sh pinning` starts the dev Postgres and object storage and runs it. `ROWS` (100,000),
`LOAD_SECONDS` (20 per phase) and `CONCURRENCY` (48) change the run. On Linux each server gets its own quarter
of the cores, so adding replicas adds CPUs as separate machines would; elsewhere they share them.

## Cloudflare R2

`cloud/r2/run.sh` runs the filesystem suites against an R2 bucket instead of the local object storage. Copy
`cloud/r2/r2.env.example` to `cloud/r2/r2.env` (git ignores it) and fill in the bucket, the account's endpoint
and a token that can read and write that bucket only. Arguments go to `filesystem/run.py`:

```bash
benchmarks/cloud/r2/run.sh store --quick --client "laptop, Bangalore"     # check this first
benchmarks/cloud/r2/run.sh --client "aws c7g.2xlarge us-east-1"           # the full run
```

`--client` is needed with any bucket that is not local: the distance to the bucket is in every number. The
proxy speaks plain HTTP, so it can't sit in front of R2 over HTTPS; these runs report times only, and the
local runs give the request counts, which do not depend on the bucket. Each run deletes what it wrote.

R2's free tier allows 10 GB stored, 1 million writes and 10 million reads a month. A full run writes about
150,000 objects and reads about 100,000, so several full runs a month fit.

## AWS

`cloud/aws/run.sh` runs everything on real object storage and an NVMe machine in one region, with your AWS
CLI login. `plan` says what it creates and costs, `up` starts it, `status` shows how it goes, `fetch` copies
the results to `results/` and `down` deletes everything. The machine runs on its own, saves each result to
the bucket as soon as it has it and turns itself off at the end, or after `HOURS` (8) at most, so a forgotten
run stops costing money. `INSTANCE` picks the machine. It can also be started from the **Benchmarks** workflow
in GitHub Actions.

`MINI=1` runs only the keys check and the index, on `SETS` (`sift-1m cohere-1m` by default), with `INDEX_ARGS`
added to each run, such as `--probes default --filters none,1 --queries 300 --cold-queries 50`. Setup runs in
parallel (packages with Rust, datasets downloading four files at a time while Skywake builds), and each
step's output goes to `results/logs/<step>.log`, so `results/run.log` reads as one line per step plus the
benchmarks' progress, and `results/events.jsonl` has the same steps as JSON lines.

`FILESYSTEM=1` runs only the filesystem suites, latency included, with `FS_ARGS` added to `run.py`, such as
`--repeat 3`. It skips the datasets, the index and pinning, builds only what the suites need and stops after
`HOURS` (2) at most:

```bash
AWS_REGION=ap-southeast-2 FILESYSTEM=1 benchmarks/cloud/aws/run.sh up
```

## In CI

Every pull request compiles every bench (`cargo bench --no-run`) and runs `scripts/bench.sh micro --quick`
and `scripts/bench.sh index --quick`. These catch a bench that no longer builds or runs; the times on a shared
runner mean little. The heavy runs (full index sets, the filesystem suites, pinning, AWS) only start by hand,
from the **Benchmarks** workflow, and upload their results as an artifact.
