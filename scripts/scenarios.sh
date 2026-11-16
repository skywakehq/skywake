#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
export SKYWAKE_API_DATABASE=${SKYWAKE_API_DATABASE:-postgres://skywake:skywake-dev@localhost:5433/skywake_test}

log=$(mktemp)
node "$root/apps/api/test/scenario-server.ts" >"$log" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true; rm -f "$log"' EXIT

for _ in $(seq 1 100); do
  grep -q '^SCENARIO ' "$log" && break
  kill -0 $pid 2>/dev/null || { cat "$log"; exit 1; }
  sleep 0.2
done
started=$(grep -m1 '^SCENARIO ' "$log" | cut -d' ' -f2-)
[ -n "$started" ] || { cat "$log"; exit 1; }

export SKYWAKE_SCENARIO_URL=$(node -e 'console.log(JSON.parse(process.argv[1]).url)' "$started")
export SKYWAKE_SCENARIO_KEY=$(node -e 'console.log(JSON.parse(process.argv[1]).key)' "$started")

(cd "$root/sdks/typescript" && pnpm -s build && node --test --test-concurrency=1 test/scenarios.test.ts)
uv run --isolated --with pytest --with-editable "$root/sdks/python" pytest -q "$root/sdks/python/tests/test_scenarios.py"
