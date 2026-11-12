#!/bin/sh
# Runs the single sign-on tests: Keycloak in Docker, the API on :8180 and
# the console on :3200 (SSO_API_PORT and SSO_CONSOLE_PORT change them), over
# their own database so nothing else is touched.
# Needs Postgres from docker/dev/compose.yaml. KEEP=1 leaves it all running
# afterwards, to try in a browser.
set -e
cd "$(dirname "$0")/../.."

DATABASE=${SSO_DATABASE:-postgres://skywake:skywake-dev@localhost:5433/skywake_sso}
API_PORT=${SSO_API_PORT:-8180}
CONSOLE_PORT=${SSO_CONSOLE_PORT:-3200}
docker compose -f e2e/sso/compose.yaml up -d --pull missing >/dev/null 2>&1
# A new database each run, so earlier runs' connections don't get in the way.
psql "${DATABASE%/*}/skywake" -q -c "DROP DATABASE IF EXISTS ${DATABASE##*/} WITH (FORCE)" \
  -c "CREATE DATABASE ${DATABASE##*/}"

store=$(mktemp -d)
set -a
CONSOLE_URL=http://localhost:$CONSOLE_PORT
DATABASE_URL=$DATABASE
BETTER_AUTH_URL=http://localhost:$CONSOLE_PORT
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
SKYWAKE_API_URL=http://127.0.0.1:$API_PORT/v1
SKYWAKE_API_ADMIN_TOKEN=$(openssl rand -hex 24)
PUBLIC_ZERO_URL=http://localhost:4948
PUBLIC_API_URL=http://localhost:$API_PORT
# The local Keycloak is on a private address, and nobody can add DNS records
# for example.com, so the operator vouches for both.
SSO_PRIVATE_IDP_ORIGINS=http://localhost:8380
SSO_VERIFIED_DOMAINS=example.com,forged.test

SKYWAKE_API_DATABASE=$DATABASE
SKYWAKE_STORE=$store
SKYWAKE_API_LISTEN=127.0.0.1:$API_PORT
SKYWAKE_API_RATE_LIMIT=0
# A Stripe key in the repository's .env would turn billing on, and the API
# would refuse to start without the rest of Stripe's settings.
SKYWAKE_API_BILLING=off
SKYWAKE_API_JWKS_URL=$BETTER_AUTH_URL/api/auth/jwks
SKYWAKE_API_JWT_ISSUER=skywake-console
SKYWAKE_API_JWT_AUDIENCE=skywake-console

ZERO_UPSTREAM_DB=$DATABASE
ZERO_PORT=4948
ZERO_APP_PUBLICATIONS=console
ZERO_REPLICA_FILE=$store/zero.db
ZERO_QUERY_URL=http://localhost:$CONSOLE_PORT/api/zero/query
ZERO_MUTATE_URL=http://localhost:$CONSOLE_PORT/api/zero/mutate
ZERO_QUERY_FORWARD_COOKIES=true
ZERO_MUTATE_FORWARD_COOKIES=true
set +a

# Stop what was started here on the way out, and only that.
started=""
trap 'kill $started 2>/dev/null' EXIT INT TERM
node apps/api/src/main.ts &
api=$!
started="$started $api"
until curl -s -o /dev/null localhost:$API_PORT/health; do
  kill -0 $api 2>/dev/null || { echo "the API stopped; see its output above" >&2; exit 1; }
  sleep 0.3
done
(cd apps/console && exec node_modules/.bin/next dev --port $CONSOLE_PORT) &
started="$started $!"
until curl -sf -o /dev/null localhost:8380/realms/skywake; do sleep 1; done
until curl -sf -o /dev/null localhost:$CONSOLE_PORT/api/auth/ok; do sleep 1; done

if [ -n "$KEEP" ]; then
  (cd apps/console && exec node_modules/.bin/zero-cache-dev) &
  started="$started $!"
  echo "console: http://localhost:$CONSOLE_PORT  keycloak: http://localhost:8380 (admin/admin)"
  wait
fi
cd e2e/sso && node --test --test-concurrency=1 "*.test.ts"
