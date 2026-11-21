#!/bin/bash
# Moves the hosted machine to a release: the release's compose.yaml and
# roles.sh, this commit's hosted files, then the new images.
#
#   deploy.sh VERSION COMMIT
set -euo pipefail
version=$1
commit=$2
cd /opt/skywake

release=https://github.com/skywakehq/skywake/releases/download/v$version
raw=https://raw.githubusercontent.com/skywakehq/skywake/$commit/deploy/hosted
curl -fsSL -o compose.yaml.new "$release/compose.yaml"
curl -fsSL -o roles.sh.new "$release/roles.sh"
curl -fsSL -o compose.hosted.yaml.new "$raw/compose.hosted.yaml"
curl -fsSL -o Caddyfile.new "$raw/Caddyfile"
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
