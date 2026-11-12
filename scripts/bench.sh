#!/bin/bash
# Runs one group of benchmarks; --quick runs it small, to check a change. Results go to benchmarks/results/ and
# scripts/compare-benchmarks.sh puts two runs side by side. See benchmarks/README.md.
#
#   scripts/bench.sh micro [--quick]                          Criterion, in core, index and cache
#   scripts/bench.sh index --quick                            a 5,000-row synthetic set on the local store
#   scripts/bench.sh index <dataset dir> [index-bench run options]
#   scripts/bench.sh filesystem [--quick] [suite ...] [run.py options]   in the Linux container unless on Linux
#   scripts/bench.sh filesystem latency [run.py options]      branch operations, small I/O and workloads
#   scripts/bench.sh pinning [--quick]                        three API servers on the dev Postgres and object storage
#   scripts/bench.sh scale [--quick] [scale-bench run options] filesystems of growing size, and how each cost grows
#   scripts/bench.sh cloud aws plan|up|status|fetch|down      the full run on AWS
#   scripts/bench.sh cloud r2 [run.py options]                the filesystem suites on Cloudflare R2
set -euo pipefail
cd "$(dirname "$0")/.."

group=${1:-}
[ $# -gt 0 ] && shift
quick=false
args=()
for arg in "$@"; do
  if [ "$arg" = --quick ]; then quick=true; else args+=("$arg"); fi
done
BIN=${CARGO_TARGET_DIR:-target}/release

build() { cargo build --release --quiet "$@"; }
dev_services() { docker compose -f docker/dev/compose.yaml up -d --quiet-pull "$@" >/dev/null; }
dev_store() {
  dev_services s3 bucket
  export SKYWAKE_STORE=${SKYWAKE_STORE:-s3://skywake$1} AWS_ENDPOINT=${AWS_ENDPOINT:-http://localhost:9100}
  export AWS_ALLOW_HTTP=${AWS_ALLOW_HTTP:-true} AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-skywake}
  export AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-skywake-dev} AWS_REGION=${AWS_REGION:-us-east-1}
}

case "$group" in
  micro)
    filter=()
    $quick && filter=(-- --quick)
    cargo bench -p skywake-core --bench core "${filter[@]}"
    cargo bench -p skywake-index --features bench --bench index "${filter[@]}"
    cargo bench -p skywake-cache --bench cache "${filter[@]}"
    ;;
  index)
    build -p skywake-benchmarks
    if $quick; then
      data=benchmarks/datasets/data/synth-5k
      [ -f "$data/dataset.json" ] || "$BIN/index-bench" gen "$data" --rows 5000 --dims 128 --queries 100
      exec "$BIN/index-bench" run "$data" --queries 100 --cold-queries 20 --probes default,16 --filters 10,1 \
        ${args[@]+"${args[@]}"}
    fi
    [ ${#args[@]} -gt 0 ] || { echo "usage: scripts/bench.sh index --quick | <dataset dir> [options]" >&2; exit 1; }
    exec "$BIN/index-bench" run "${args[@]}"
    ;;
  filesystem)
    $quick && args=(--quick ${args[@]+"${args[@]}"})
    packages=(-p skywake-cli -p skywake-daemon -p skywake-cache -p skywake-benchmarks)
    if [ "$(uname)" = Linux ] && [ -e /dev/fuse ]; then
      dev_store ""
      build "${packages[@]}"
      exec benchmarks/filesystem/run.py ${args[@]+"${args[@]}"}
    fi
    dev_services s3 bucket
    exec scripts/shell.sh sh -c 'cargo build --release --quiet '"${packages[*]}"' && benchmarks/filesystem/run.py "$@"' \
      sh ${args[@]+"${args[@]}"}
    ;;
  pinning)
    dev_services postgres
    dev_store /pinning
    build -p skywake-benchmarks
    pnpm --filter @skywake/engine build >/dev/null
    export SKYWAKE_API_DATABASE=${SKYWAKE_API_DATABASE:-postgres://skywake:skywake-dev@localhost:5433/skywake}
    if $quick; then export ROWS=${ROWS:-2000} LOAD_SECONDS=${LOAD_SECONDS:-3} CONCURRENCY=${CONCURRENCY:-4}; fi
    exec benchmarks/pinning/run.sh
    ;;
  scale)
    build -p skywake-benchmarks
    $quick && args=(--files 1000,10000 --runs 3 ${args[@]+"${args[@]}"})
    exec "$BIN/scale-bench" run ${args[@]+"${args[@]}"}
    ;;
  cloud)
    target=${args[0]:-}
    case "$target" in
      aws | r2) exec "benchmarks/cloud/$target/run.sh" "${args[@]:1}" ;;
      *) echo "usage: scripts/bench.sh cloud aws|r2 ..." >&2; exit 1 ;;
    esac
    ;;
  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 1
    ;;
esac
