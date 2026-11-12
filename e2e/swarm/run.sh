#!/bin/sh
# Runs the 100-agent exit test against the API that scripts/console.sh starts
# on localhost:8080. Start that first, in another terminal.
set -e
cd "$(dirname "$0")/../.."
python3 -m venv /tmp/swarm
/tmp/swarm/bin/pip install --quiet "./sdks/python[mcp]"

# The repository's .env holds the admin token; without it, set
# SKYWAKE_API_ADMIN_TOKEN or SKYWAKE_KEY yourself (CI does).
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
SKYWAKE_URL=${SKYWAKE_URL:-http://127.0.0.1:8080} /tmp/swarm/bin/python e2e/swarm/orchestrator.py
