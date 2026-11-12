#!/bin/sh
# Writes the API's OpenAPI document from the contract, and rebuilds the
# TypeScript SDK's types from it. Run it after changing a route.
# Needs Node 22.18 or later.
set -e
cd "$(dirname "$0")/.."
node packages/contract/emit.ts
pnpm -s --filter @skywake/sdk exec openapi-typescript ../../packages/contract/generated/openapi.json \
  -o src/generated/schema.ts --default-non-nullable false
