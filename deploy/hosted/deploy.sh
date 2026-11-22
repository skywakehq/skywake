#!/bin/bash
# Moves the hosted machine to a release: compose.yaml, roles.sh and the hosted
# files as of the release's commit, then the new images. Every file comes from
# the commit itself, never a release asset, which anyone who can edit releases
# could swap.
#
#   deploy.sh VERSION COMMIT
set -euo pipefail
version=$1
commit=$2
cd /opt/skywake

[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo "not a commit: $commit" >&2; exit 1; }
raw=https://raw.githubusercontent.com/skywakehq/skywake/$commit
curl -fsSL -o compose.yaml.new "$raw/deploy/compose/compose.yaml"
# deploy/compose/roles.sh is a link to this file; raw links serve the link, not the file.
curl -fsSL -o roles.sh.new "$raw/docker/postgres/roles.sh"
curl -fsSL -o compose.hosted.yaml.new "$raw/deploy/hosted/compose.hosted.yaml"
curl -fsSL -o Caddyfile.new "$raw/deploy/hosted/Caddyfile"
# Copied over, not moved: Caddy holds the Caddyfile open by its inode.
for file in compose.yaml roles.sh compose.hosted.yaml Caddyfile; do
  cp "$file.new" "$file" && rm "$file.new"
done
sed -i "s/^SKYWAKE_VERSION=.*/SKYWAKE_VERSION=$version/" .env

compose="docker compose -f compose.yaml -f compose.hosted.yaml"
$compose pull --quiet
$compose up -d --wait --wait-timeout 600 --remove-orphans
docker exec -w /etc/caddy skywake-caddy-1 caddy reload --config /etc/caddy/Caddyfile
docker image prune -f > /dev/null
$compose ps --format '{{.Service}} {{.Image}} {{.Status}}'
