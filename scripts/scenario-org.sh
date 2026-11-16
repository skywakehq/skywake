#!/usr/bin/env bash
set -euo pipefail

url=${1:?url}
admin=${2:?admin token}
curl -sf -X POST "$url/v1/orgs" \
  -H "authorization: Bearer $admin" \
  -H "content-type: application/json" \
  -d "{\"name\":\"scenarios-$(date +%s%N)-$RANDOM\"}" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).key))'
