#!/bin/sh
# Runs Skywake on this machine: installs Docker if needed, writes .env, builds and starts everything.
#
#   scripts/start.sh          start, or update after a git pull
#   scripts/start.sh stop     stop, keeping the data
set -e
cd "$(dirname "$0")/.."
. scripts/lib/need.sh
SKYWAKE_ARGS="$*"

need_tools
need_docker 6

if [ "${1:-}" = stop ]; then
  docker compose down
  exit
fi

scripts/setup.sh >/dev/null
set -a
. ./.env
set +a

# A port moved in .env moves its local address too.
follow() {
  port=$(eval echo "\${$2:-}")
  url=$(eval echo "\${$1:-}")
  if [ -n "$port" ] && [ "$url" = "http://localhost:$3" ]; then
    sed -i.bak "s#^$1=.*#$1=http://localhost:$port#" .env && rm .env.bak
    export "$1=http://localhost:$port"
  fi
}
follow CONSOLE_URL CONSOLE_PORT 3100
follow API_URL API_PORT 8080
follow ZERO_URL ZERO_PORT 4848

if [ -z "$(docker compose ps -q api 2>/dev/null)" ]; then
  free_port "${API_PORT:-8080}" API_PORT
  free_port "${CONSOLE_PORT:-3100}" CONSOLE_PORT
  free_port "${ZERO_PORT:-4848}" ZERO_PORT
fi

say "Building (the first time takes 10 to 20 minutes)"
# One image at a time: building both at once needs more memory than most Docker VMs have.
docker compose build api
docker compose build console
say "Starting"
docker compose up -d

api=http://localhost:${API_PORT:-8080}
console=http://localhost:${CONSOLE_PORT:-3100}
for _ in $(seq 120); do
  curl -fs -o /dev/null "$api/ready" && curl -fs -o /dev/null "$console" && break
  sleep 2
done
curl -fs -o /dev/null "$api/ready" || fail "The API did not start. See: docker compose logs api"
curl -fs -o /dev/null "$console" || fail "The console did not start. See: docker compose logs console"

say "Skywake is running."
echo "  Console  ${CONSOLE_URL:-$console}   (sign up, make an organization, then an API key)"
echo "  API      ${API_URL:-$api}"
echo "  Stop     scripts/start.sh stop"
