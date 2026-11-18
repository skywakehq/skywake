#!/bin/bash
# Runs on the benchmark machine, started by benchmarks/cloud/aws/run.sh up. Builds
# Skywake, runs every benchmark against the bucket, saves each result to
# s3://$BUCKET/results/ as soon as it is done, then turns the machine off,
# which deletes it.
#
# results/run.log has one line per step, plus the benchmarks' own progress;
# results/events.jsonl has the same steps as JSON lines; each step's full
# output is in results/logs/<step>.log.
set -euo pipefail

# However the run goes, the machine is gone after $HOURS hours.
shutdown -h "+$((HOURS * 60))"

RESULTS=/root/results
LOGS=$RESULTS/logs
mkdir -p "$LOGS"
exec > >(tee "$RESULTS/run.log") 2>&1
STARTED=$(date +%s)

span() {
  local s=$1
  if ((s < 60)); then echo "${s} s"
  elif ((s < 3600)); then echo "$((s / 60))m $((s % 60))s"
  else echo "$((s / 3600))h $((s % 3600 / 60))m"; fi
}

clock() {
  local s=$1
  if ((s < 3600)); then printf '%d:%02d' $((s / 60)) $((s % 60))
  else printf '%d:%02d:%02d' $((s / 3600)) $((s % 3600 / 60)) $((s % 60)); fi
}

# One line in run.log and one JSON line in events.jsonl.
say() {
  local step=$1 event=$2 message=$3 elapsed=$(($(date +%s) - STARTED))
  printf '%s  +%-7s %-9s %s\n' "$(date -u +%H:%M:%S)" "$(clock "$elapsed")" "$step" "$message"
  printf '{"time":"%s","elapsed_seconds":%d,"step":"%s","event":"%s","message":"%s"}\n' \
    "$(date -u +%FT%TZ)" "$elapsed" "$step" "$event" "${message//\"/\\\"}" >>"$RESULTS/events.jsonl"
}

# step NAME "what it does" command...: the command's output goes to
# logs/NAME.log; run.log gets a line before and after, and the log's last
# lines if it fails.
step() {
  local name=$1 what=$2 started status
  shift 2
  started=$(date +%s)
  say "$name" start "$what"
  if "$@" >>"$LOGS/$name.log" 2>&1; then
    say "$name" done "done in $(span $(($(date +%s) - started)))"
  else
    status=$?
    say "$name" failed "failed with status $status after $(span $(($(date +%s) - started))); see logs/$name.log"
    tail -n 15 "$LOGS/$name.log" | sed 's/^/    /'
    return "$status"
  fi
}

save() { aws s3 cp --quiet --recursive "$RESULTS" "s3://$BUCKET/results/"; }
finish() {
  local status=$?
  say run end "finished with status $status after $(span $(($(date +%s) - STARTED)))"
  save
  shutdown -h now
}
trap finish EXIT
# The log reaches the bucket every minute, so `status` can show it.
(while sleep 60; do save >/dev/null 2>&1 || true; done) &

FILESYSTEM=${FILESYSTEM:-0}
TPUF=${TPUF:-0}
if [ "$TPUF" = 1 ]; then
  say run start "$INSTANCE in $AWS_REGION · turbopuffer's vector-10m through the API"
elif [ "$FILESYSTEM" = 1 ]; then
  say run start "$INSTANCE in $AWS_REGION · filesystem only${FS_ARGS:+ · $FS_ARGS}"
else
  say run start "$INSTANCE in $AWS_REGION · sets: $SETS${INDEX_ARGS:+ · $INDEX_ARGS}"
fi

# The instance's own NVMe drive holds the build, the datasets and the cache.
disk() {
  local disk
  disk=$(lsblk -dno NAME,MODEL | awk '/Instance Storage/ { print "/dev/" $1; exit }')
  mkfs.xfs -f "$disk" && mkdir -p /data && mount "$disk" /data && mkdir -p /data/tmp /data/skywake
}
step disk "format and mount the NVMe drive" disk
export TMPDIR=/data/tmp CARGO_TARGET_DIR=/data/target

# Packages, Rust and the source come down at the same time.
packages() {
  dnf install -y -q gcc gcc-c++ make cmake clang git openssl-devel pkgconf fuse3 fuse3-devel \
    python3.11 python3.11-pip nodejs npm tar fio &&
    { [ "$FILESYSTEM" = 1 ] || python3.11 -m pip install -q h5py numpy pyarrow; }
}
rust() { curl -sSf https://sh.rustup.rs | sh -s -- -y -q --profile minimal --default-toolchain 1.99; }
source_tree() {
  cd /data/skywake &&
    aws s3 cp --quiet "s3://$BUCKET/source.tar.gz" - | tar -xz &&
    # The mount suite copies this tree and runs git in it.
    git init -q && git add -A && git -c user.name=bench -c user.email=bench@localhost commit -qm snapshot
}
step packages "compilers, python and its data libraries" packages &
setup=$!
step rust "the Rust toolchain" rust
wait "$setup"
step source "the source tree from the bucket" source_tree
source "$HOME/.cargo/env"
cd /data/skywake

# Datasets come down while Skywake builds; each set's marker says it is ready.
fetch_sets() {
  for set in $SETS; do
    if python3.11 benchmarks/datasets/fetch.py get "$set" --dir /data/datasets; then
      touch "/data/datasets/$set.ready"
    else
      touch "/data/datasets/$set.failed"
    fi
  done
}
mkdir -p /data/datasets
[ "$FILESYSTEM" = 1 ] || (fetch_sets 2>&1 | grep --line-buffered -v '^/data/datasets/') &

build() {
  if [ "$FILESYSTEM" = 1 ]; then
    cargo build --release -p skywake-cli -p skywake-daemon -p skywake-cache &&
      cargo build --release -p skywake-benchmarks --bin s3-proxy
  else
    cargo build --release -p skywake-cli -p skywake-daemon -p skywake-cache -p skywake-benchmarks &&
      cargo test --release -p skywake-core --test encryption --no-run
  fi
}
step build "Skywake in release mode" build

STORE=s3://$BUCKET
CLIENT="aws $INSTANCE $AWS_REGION, same region as the bucket"
export SKYWAKE_INDEX_CACHE_DIR=/data/cache

# The filesystem: every suite, latency included.
filesystem() {
  # shellcheck disable=SC2086
  SKYWAKE_STORE=$STORE/fs python3.11 benchmarks/filesystem/run.py store mount save daemon fleet latency \
    --client "$CLIENT" --allow-dirty --note "$NOTE" --out "$RESULTS/filesystem" $FS_ARGS
}
if [ "$FILESYSTEM" = 1 ]; then
  step filesystem "every filesystem suite, latency included" filesystem
  exit
fi

postgres() {
  dnf install -y -q postgresql16-server &&
    postgresql-setup --initdb &&
    sed -i 's/ident$/scram-sha-256/' /var/lib/pgsql/data/pg_hba.conf &&
    systemctl start postgresql &&
    sudo -u postgres psql -qc "CREATE ROLE bench LOGIN PASSWORD 'bench'" -c "CREATE DATABASE bench OWNER bench"
}
api() {
  curl -sSf https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-x64.tar.xz | tar -xJ -C /data &&
    export PATH=/data/node-v22.20.0-linux-x64/bin:$PATH &&
    corepack enable && pnpm install --frozen-lockfile --filter @skywake/api... &&
    cargo build --release -p skywake-node &&
    cp "$CARGO_TARGET_DIR/release/libskywake_node.so" bindings/node/engine.node
}

# turbopuffer's vector-10m: one API server on the bucket, the client on the same machine.
if [ "$TPUF" = 1 ]; then
  step postgres "a local Postgres for the API" postgres &
  setup=$!
  step api "the API and its engine binding" api
  wait "$setup"
  export PATH=/data/node-v22.20.0-linux-x64/bin:$PATH
  export SKYWAKE_API_ADMIN_TOKEN=bench-admin-$RANDOM$RANDOM$RANDOM SKYWAKE_API_RATE_LIMIT=0
  SKYWAKE_API_DATABASE=postgres://bench:bench@127.0.0.1/bench SKYWAKE_STORE=$STORE/tpuf \
    SKYWAKE_API_LISTEN=127.0.0.1:8080 SKYWAKE_API_PEER_URL=http://127.0.0.1:8080 \
    SKYWAKE_API_PEER_TOKEN=bench-peer-$RANDOM$RANDOM SKYWAKE_INDEX_CACHE_GB=200 \
    node apps/api/src/main.ts >"$LOGS/api-server.log" 2>&1 &
  server=$!
  (while kill -0 "$server" 2>/dev/null; do
    echo "$(date -u +%H:%M:%S) rss $(($(ps -o rss= -p "$server") / 1024)) MB · free $(free -m | awk '/Mem:/ {print $7}') MB"
    sleep 15
  done; dmesg | grep -iE "out of memory|killed process" | tail -3) >"$RESULTS/memory.log" 2>&1 &
  until curl -sf http://127.0.0.1:8080/health >/dev/null; do sleep 1; done
  SKYWAKE_API_KEY=$(curl -sf -X POST http://127.0.0.1:8080/v1/orgs -H "authorization: Bearer $SKYWAKE_API_ADMIN_TOKEN" \
    -H 'content-type: application/json' -d '{"name":"bench-tpuf"}' |
    python3.11 -c 'import json,sys; print(json.load(sys.stdin)["key"])')
  export SKYWAKE_API_KEY
  set=cohere-wiki-10m
  say "$set" wait "waiting for the dataset"
  until [ -e "/data/datasets/$set.ready" ] || [ -e "/data/datasets/$set.failed" ]; do sleep 5; done
  [ -e "/data/datasets/$set.ready" ] || { say "$set" failed "the dataset did not download"; exit 1; }
  bench() { "$CARGO_TARGET_DIR/release/index-bench" api --url http://127.0.0.1:8080 --dataset "/data/datasets/$set" "$@"; }
  step tpuf "load 10M x 1024 over HTTP, then top 10 at 8 QPS, uniform queries" \
    bench --rows 10000000 --batch 1000 --writers 8 --settle 60 --families vector --probes uniform \
    --qps 8 --warm 300 --seconds 600 --recall 100 --out "$RESULTS/tpuf-uniform"
  save
  index=$(python3.11 -c 'import json,sys; print(json.load(open(sys.argv[1]))["settings"]["index"])' \
    "$RESULTS/tpuf-uniform/results.json")
  step recall "real held-out queries on the same index, unfiltered and at 1%" \
    bench --index "$index" --families vector,vector-filtered --probes dataset \
    --qps 8 --warm 60 --seconds 120 --recall 1000 --out "$RESULTS/tpuf-dataset"
  exit
fi

# 1. Customer-managed keys.
cmek() {
  SKYWAKE_TEST_BUCKET=$STORE/cmek SKYWAKE_TEST_KMS_KEY=$KMS_KEY \
    cargo test --release -p skywake-core --test encryption -- --ignored >"$RESULTS/cmek.txt" 2>&1
  aws s3api head-object --bucket "$BUCKET" --key cmek/kms/check \
    --query '{encryption: ServerSideEncryption, key: SSEKMSKeyId}' >>"$RESULTS/cmek.txt" 2>&1
}
step cmek "customer-managed keys (SSE-KMS and SSE-C) on the bucket" cmek || true
save

# 2 and 3. The index, on each of $SETS.
for set in $SETS; do
  say "$set" wait "waiting for the dataset"
  until [ -e "/data/datasets/$set.ready" ] || [ -e "/data/datasets/$set.failed" ]; do sleep 5; done
  if [ -e "/data/datasets/$set.failed" ]; then
    say "$set" failed "the dataset did not download; skipped"
    continue
  fi
  say "$set" start "index benchmark"
  # Progress goes to run.log; the report to results/index-$set/report.md.
  # shellcheck disable=SC2086
  "$CARGO_TARGET_DIR/release/index-bench" run "/data/datasets/$set" \
    --store "$STORE/index" --allow-remote --disk-cache --disk-cache-gb 200 $INDEX_ARGS \
    --out "$RESULTS/index-$set" >"$LOGS/index-$set.log" ||
    say "$set" failed "the index benchmark failed; see logs/index-$set.log"
  rm -rf "/data/datasets/$set" "$SKYWAKE_INDEX_CACHE_DIR"
  save
done

[ "${MINI:-0}" = 1 ] && exit 0

# 4. The filesystem.
step filesystem "every filesystem suite, latency included" filesystem || true
save

# 5. Pinned indexes with read replicas: three API servers on this machine,
# each with its own disk cache, over the bucket and a local Postgres.
pinning() {
  SKYWAKE_API_DATABASE=postgres://bench:bench@127.0.0.1/bench SKYWAKE_STORE=$STORE/pinning \
    SKYWAKE_INDEX_CACHE_GB=20 ROWS=1000000 LOAD_SECONDS=60 RESULTS=$RESULTS/pinning \
    benchmarks/pinning/run.sh
}
step postgres "a local Postgres for the API" postgres &
setup=$!
step api "the API and its engine binding" api
wait "$setup"
export PATH=/data/node-v22.20.0-linux-x64/bin:$PATH
step pinning "1M rows through three API servers: unpinned, 1 and 3 replicas" pinning || true
