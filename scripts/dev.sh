#!/bin/sh
# Runs Skywake from source with live reload, installing whatever is missing first.
#
#   scripts/dev.sh        the console on :3100, the API on :8080, zero-cache on :4848
#   scripts/dev.sh all    the site, docs and console together on :3000
set -e
cd "$(dirname "$0")/.."
. scripts/lib/need.sh
SKYWAKE_ARGS="$*"

need_tools
need_node
need_rust
need_docker 2

for port in 8080 3100 4848; do free_port $port; done
case ${1:-} in
  all)
    free_port 3000; free_port 3200
    exec scripts/dev-all.sh
    ;;
  "") exec scripts/console.sh ;;
  *) fail "usage: scripts/dev.sh [all]" ;;
esac
