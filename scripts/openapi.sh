#!/bin/sh
set -e
cd "$(dirname "$0")/.."
node packages/contract/emit.ts
pnpm -s --filter @skywake/sdk exec openapi-typescript ../../packages/contract/generated/openapi-v2.json \
  -o src/generated/v2.ts --default-non-nullable false
