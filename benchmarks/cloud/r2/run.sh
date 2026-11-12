#!/bin/sh
# Runs the filesystem benchmarks against Cloudflare R2 instead of the local object storage, with the settings in
# benchmarks/cloud/r2/r2.env (see r2.env.example next to it). Arguments go to benchmarks/filesystem/run.py; start
# small:
#
#   benchmarks/cloud/r2/run.sh store --quick --client "laptop, Bangalore"
#   benchmarks/cloud/r2/run.sh --quick --client "aws c7g.2xlarge us-east-1"
set -e
cd "$(dirname "$0")/../../.."
ENV=benchmarks/cloud/r2/r2.env
[ -f "$ENV" ] || { echo "Copy $ENV.example to $ENV and fill it in." >&2; exit 1; }
STORE_ENV=$ENV exec scripts/shell.sh sh -c \
  'cargo build --release --quiet -p skywake-cli -p skywake-daemon -p skywake-cache -p skywake-benchmarks \
    && benchmarks/filesystem/run.py --note "Cloudflare R2" "$@"' sh "$@"
