#!/bin/sh
# Runs the whole product on one address, http://localhost:3000, as Next.js
# zones: the site at /, the docs at /docs and the console at /dashboard.
# Leave a zone out with --no-docs or --no-console; the site then runs
# without it. Needs what scripts/console.sh needs.
set -e
cd "$(dirname "$0")/.."

docs=1
console=1
for arg in "$@"; do
  case $arg in
    --no-docs) docs= ;;
    --no-console) console= ;;
    *) echo "usage: $0 [--no-docs] [--no-console]" >&2; exit 2 ;;
  esac
done

export SITE_URL=http://localhost:3000
trap 'kill 0' EXIT INT TERM

if [ -n "$docs" ]; then
  export DOCS_BASE_PATH=/docs DOCS_URL=http://localhost:3200
  pnpm -s --filter @skywake/docs dev &
fi
if [ -n "$console" ]; then
  export CONSOLE_BASE_PATH=/dashboard CONSOLE_URL=http://localhost:3100
  scripts/console.sh &
fi
pnpm -s --filter @skywake/www dev
