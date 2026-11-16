#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
export SKYWAKE_API_DATABASE=${SKYWAKE_API_DATABASE:-postgres://skywake:skywake-dev@localhost:5433/skywake_test}
suites=("$@")
[ ${#suites[@]} -gt 0 ] || suites=(typescript python go rust java csharp ruby)

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
field() { node -e 'console.log(JSON.parse(process.argv[1])[process.argv[2]])' "$started" "$1"; }
export SKYWAKE_SCENARIO_URL=$(field url)
admin=$(field admin)

run() {
  case $1 in
    typescript) (cd "$root/sdks/typescript" && pnpm -s build && node --test --test-concurrency=1 test/scenarios.test.ts) ;;
    python) uv run --isolated --with pytest --with-editable "$root/sdks/python" pytest -q "$root/sdks/python/tests/test_scenarios.py" ;;
    go) (cd "$root/sdks/go" && go test -count=1 -run Scenario ./...) ;;
    rust) (cd "$root" && cargo test -q -p skywake-client --test scenarios -- --test-threads=1) ;;
    java) (cd "$root/sdks/java" && mvn -q test -Dtest='ScenarioTest') ;;
    csharp) (cd "$root/sdks/csharp" && dotnet test --nologo -v q --filter 'FullyQualifiedName~Scenario') ;;
    ruby) (cd "$root/sdks/ruby" && ruby -Ilib -Itest test/scenarios_test.rb) ;;
    *) echo "unknown suite: $1" >&2; exit 2 ;;
  esac
}

for suite in "${suites[@]}"; do
  echo "== $suite"
  SKYWAKE_SCENARIO_KEY=$("$root/scripts/scenario-org.sh" "$SKYWAKE_SCENARIO_URL" "$admin") run "$suite"
done
