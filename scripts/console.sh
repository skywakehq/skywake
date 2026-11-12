#!/bin/sh
# Runs the web console on http://localhost:3100 with all it needs: S3 and
# Postgres from docker/dev/compose.yaml, the API on :8080 and zero-cache on :4848.
# Needs Node 22.18 or later.
set -e
cd "$(dirname "$0")/.."
# Postgres and S3. With Colima, Docker listens on Colima's socket, not the
# default one, so use it when the default is missing. A failure stops here
# instead of leaving the console without a database.
if [ -z "${DOCKER_HOST:-}" ] && [ ! -S /var/run/docker.sock ] && [ -S "$HOME/.colima/default/docker.sock" ]; then
  export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
fi
docker compose --progress quiet -f docker/dev/compose.yaml up -d
docker compose --progress quiet -f docker/dev/compose.yaml up -d --wait postgres

scripts/setup.sh >/dev/null
set -a
. ./.env
# Development: the bundled store and Postgres from docker/dev/compose.yaml,
# unless .env names a bucket of your own.
if [ -z "$SKYWAKE_STORE" ]; then
  SKYWAKE_STORE=s3://skywake AWS_ENDPOINT=http://localhost:9100 AWS_ALLOW_HTTP=true
  AWS_ACCESS_KEY_ID=skywake AWS_SECRET_ACCESS_KEY=skywake-dev
  # A second bucket stands in for a second region.
  SKYWAKE_API_REGIONS=eu-central-1=s3://skywake-eu
fi
DATABASE_URL=postgres://skywake:skywake-dev@localhost:5433/skywake
SKYWAKE_API_DATABASE=$DATABASE_URL SKYWAKE_API_LISTEN=127.0.0.1:8080
SKYWAKE_API_URL=$API_URL/v1 PUBLIC_API_URL=$API_URL PUBLIC_ZERO_URL=$ZERO_URL
BETTER_AUTH_URL=$CONSOLE_URL
SKYWAKE_API_JWKS_URL=http://localhost:3100${CONSOLE_BASE_PATH:-}/api/auth/jwks
# zero-cache, which keeps the console current.
ZERO_UPSTREAM_DB=$DATABASE_URL ZERO_APP_PUBLICATIONS=console
ZERO_REPLICA_FILE=/tmp/skywake-console.db
ZERO_QUERY_URL=http://localhost:3100${CONSOLE_BASE_PATH:-}/api/zero/query
ZERO_MUTATE_URL=http://localhost:3100${CONSOLE_BASE_PATH:-}/api/zero/mutate
ZERO_QUERY_FORWARD_COOKIES=true ZERO_MUTATE_FORWARD_COOKIES=true
# Behind the site (scripts/dev-all.sh), people reach the console at a path on
# the site's address.
if [ -n "${CONSOLE_BASE_PATH:-}" ]; then
  BETTER_AUTH_URL=${SITE_URL:-http://localhost:3000}
fi
SKYWAKE_API_JWT_ISSUER=skywake-console SKYWAKE_API_JWT_AUDIENCE=skywake-console
set +a

trap 'kill 0' EXIT INT TERM
pnpm -s install
pnpm -s --filter @skywake/engine build
node apps/api/src/main.ts &
until curl -s -o /dev/null localhost:8080/health; do sleep 0.3; done

cd apps/console
pnpm -s zero &
pnpm -s dev
