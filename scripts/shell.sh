#!/bin/sh
# Opens a Linux shell, or runs a command, with FUSE, the repo at /skywake,
# and the local S3 and Postgres from docker/dev/compose.yaml.
#
#   scripts/shell.sh                      interactive shell
#   scripts/shell.sh cargo test           run a command
#
# STORE_ENV names a file of store settings to use instead of the local S3,
# such as benchmarks/cloud/r2/r2.env.
set -e
cd "$(dirname "$0")/.."
docker build -q -t skywake-dev docker/dev >/dev/null
if [ -n "$STORE_ENV" ]; then
  store="--env-file $STORE_ENV"
else
  store="-e SKYWAKE_STORE=s3://skywake -e AWS_ENDPOINT=http://s3:9000 -e AWS_ALLOW_HTTP=true
    -e AWS_ACCESS_KEY_ID=skywake -e AWS_SECRET_ACCESS_KEY=skywake-dev -e AWS_REGION=us-east-1"
fi
exec docker run --rm -i $([ -t 0 ] && echo -t) \
  --device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor=unconfined \
  --network skywake_default \
  -v "$PWD":/skywake -v skywake-target:/target -v skywake-cargo:/usr/local/cargo/registry \
  $store \
  -e SKYWAKE_API_DATABASE=postgres://skywake:skywake-dev@postgres/skywake \
  skywake-dev "$@"
