#!/bin/bash
# Checks that a fresh install works end to end: the API, the bucket,
# Postgres, the console and zero-cache. Used against every install path
# (Compose, the chart, Terraform, the CloudFormation starter).
#
#   API_URL=http://localhost:8080 CONSOLE_URL=http://localhost:3100 \
#   ZERO_URL=http://localhost:4848 SKYWAKE_API_ADMIN_TOKEN=… deploy/test/smoke.sh
#
# Needs curl and jq. Makes one organization, named smoke-<time>.
set -euo pipefail

: "${API_URL:?set API_URL}" "${SKYWAKE_API_ADMIN_TOKEN:?set SKYWAKE_API_ADMIN_TOKEN}"
CONSOLE_URL=${CONSOLE_URL:-}
ZERO_URL=${ZERO_URL:-}
run=$(date +%s)
key=""

pass() { printf 'ok    %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  [ -n "${2:-}" ] && printf '      %s\n' "$2"
  exit 1
}

# call METHOD PATH [BODY] [TOKEN]: prints "status body".
call() {
  local args=(-s -o /tmp/smoke-body.$$ -w '%{http_code}' -X "$1" "$API_URL/v1$2"
    -H "authorization: Bearer ${4:-$key}" -H 'content-type: application/json')
  [ -n "${3:-}" ] && args+=(-d "$3")
  local status
  status=$(curl "${args[@]}" || true)
  printf '%s %s' "$status" "$(cat /tmp/smoke-body.$$)"
}
expect() {
  local want=$1 what=$2 got=$3
  [[ ${got%% *} =~ ^($want)$ ]] || fail "$what" "$got"
  pass "$what"
}
trap 'rm -f /tmp/smoke-body.$$' EXIT

# ── The API and what it stands on ───────────────────────────────────────
curl -sf "$API_URL/health" > /dev/null || fail "API answers /health"
pass "API answers /health"
curl -sf "$API_URL/ready" > /dev/null || fail "API is ready (Postgres and the bucket)" "$(curl -s "$API_URL/ready")"
pass "API is ready (Postgres and the bucket)"

out=$(call POST /orgs "{\"name\":\"smoke-$run\"}" "$SKYWAKE_API_ADMIN_TOKEN")
expect 201 "make an organization" "$out"
key=$(jq -r .key <<< "${out#* }")

# ── Files: commit, fork, change, merge, read back ───────────────────────
ns=/namespaces/prod%2Fapp
expect 201 "make a filesystem" "$(call POST /namespaces '{"name":"prod/app"}')"
expect 201 "make its main branch" "$(call POST "$ns/branches" '{"name":"main"}')"
expect 201 "commit to main" "$(call POST "$ns/branches/main/commits" \
  '{"message":"first","changes":[{"path":"README.md","text":"hello\n"}]}')"
expect 201 "fork a branch" "$(call POST "$ns/branches" '{"name":"agent","from":"main"}')"
expect 201 "commit on the fork" "$(call POST "$ns/branches/agent/commits" \
  '{"message":"agent","changes":[{"path":"notes/plan.md","text":"from the agent\n"}]}')"
expect "200|201" "merge the fork into main" "$(call POST "$ns/merges" '{"from":"agent","into":"main"}')"
out=$(call GET "$ns/branches/main/files/content?path=notes%2Fplan.md")
[[ $out == 200* && $out == *"from the agent"* ]] || fail "main has the merged file" "$out"
pass "main has the merged file"

# ── A search index: write, then find it ─────────────────────────────────
expect 201 "make an index" "$(call POST /indexes '{"name":"prod/docs","schema":{"vectors":[{"name":"embedding","dims":2}],"attributes":[{"name":"title","type":"string"}]}}')"
expect "200|201|202" "write to the index" "$(call POST /indexes/prod%2Fdocs/branches/main/write \
  '{"upserts":[{"id":"a","vectors":{"embedding":[1,0]},"attributes":{"title":"alpha"}},{"id":"b","vectors":{"embedding":[0,1]},"attributes":{"title":"beta"}}]}')"
out=$(call POST /indexes/prod%2Fdocs/branches/main/query '{"vector":{"column":"embedding","value":[1,0.1]},"topK":1,"include":["title"],"consistency":"strong"}')
[[ $out == 200* && $out == *alpha* ]] || fail "query finds the nearest row" "$out"
pass "query finds the nearest row"

# ── The console and zero-cache ──────────────────────────────────────────
if [ -n "$CONSOLE_URL" ]; then
  status=$(curl -s -o /dev/null -w '%{http_code}' "$CONSOLE_URL/sign-in" || true)
  [ "$status" = 200 ] || fail "console serves /sign-in" "$status"
  pass "console serves /sign-in"
  # Signing up writes to the console's own tables, so its role works.
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$CONSOLE_URL/api/auth/sign-up/email" \
    -H 'content-type: application/json' -H "origin: $CONSOLE_URL" \
    -d "{\"email\":\"smoke-$run@example.com\",\"password\":\"smoke-$run-password\",\"name\":\"Smoke\"}" || true)
  [ "$status" = 200 ] || fail "sign up in the console" "$status"
  pass "sign up in the console"
fi
if [ -n "$ZERO_URL" ]; then
  # zero-cache has no health check of its own; give a fresh one a minute.
  for _ in $(seq 30); do
    status=$(curl -s -o /dev/null -w '%{http_code}' "$ZERO_URL/" || true)
    [[ $status =~ ^(200|404)$ ]] && break
    sleep 2
  done
  [[ $status =~ ^(200|404)$ ]] || fail "zero-cache answers" "$status"
  pass "zero-cache answers"
fi

echo "smoke: all passed (organization smoke-$run)"
