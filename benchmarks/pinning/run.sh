#!/bin/bash
# Starts three API servers on one machine, each with its own disk cache as its own pod would have, and runs
# `pinning-load` through them. Needs Node 22.18 or later, a built engine.node, a release build of pinning-load,
# Postgres in SKYWAKE_API_DATABASE and the store in SKYWAKE_STORE (with its AWS_* settings). The index it makes is
# deleted at the end, and so are the caches. scripts/bench.sh pinning builds what it needs first.
#
#   SKYWAKE_API_DATABASE=postgres://… SKYWAKE_STORE=s3://bucket/pinning benchmarks/pinning/run.sh
#
# ROWS (100000), LOAD_SECONDS (20 per phase) and CONCURRENCY (48) change the run; RESULTS sets the results folder.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${SKYWAKE_API_DATABASE:?needs Postgres}" "${SKYWAKE_STORE:?needs a store}"
LOAD=${CARGO_TARGET_DIR:-target}/release/pinning-load
[ -x "$LOAD" ] || { echo "missing $LOAD: cargo build --release -p skywake-benchmarks" >&2; exit 1; }

WORK=$(mktemp -d)
export SKYWAKE_API_ADMIN_TOKEN=bench-admin-$RANDOM$RANDOM$RANDOM
export SKYWAKE_API_PEER_TOKEN=bench-peer-$RANDOM$RANDOM$RANDOM
export SKYWAKE_API_RATE_LIMIT=0

pids=()
stop() {
  kill "${pids[@]}" 2>/dev/null || true
  wait "${pids[@]}" 2>/dev/null || true
  rm -rf "$WORK"
}
trap stop EXIT

# On Linux each server gets its own quarter of the cores, as if on its own machine, and the load the last quarter;
# elsewhere they share them all.
on_cores() {
  if command -v taskset >/dev/null; then
    local share=$(($(nproc) / 4))
    taskset -c "$(($1 * share))-$((($1 + 1) * share - 1))" "${@:2}"
  else
    "${@:2}"
  fi
}

servers=()
for n in 0 1 2; do
  port=$((8181 + n))
  SKYWAKE_API_LISTEN=127.0.0.1:$port \
    SKYWAKE_API_PEER_URL=http://127.0.0.1:$port \
    SKYWAKE_INDEX_CACHE_DIR=$WORK/cache-$port \
    on_cores "$n" node apps/api/src/main.ts >"$WORK/api-$port.log" 2>&1 &
  pids+=($!)
  servers+=(http://127.0.0.1:$port)
done
for server in "${servers[@]}"; do
  until curl -sf "$server/health" >/dev/null; do sleep 0.2; done
done

on_cores 3 "$LOAD" --servers "$(IFS=,; echo "${servers[*]}")" \
  --rows "${ROWS:-100000}" --seconds "${LOAD_SECONDS:-20}" --concurrency "${CONCURRENCY:-48}" \
  ${RESULTS:+--out "$RESULTS"}
