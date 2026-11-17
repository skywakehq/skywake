skywake upsert products products.jsonl

curl -sS --fail-with-body -X PATCH "$SKYWAKE_URL/v2/indexes/products" \
  -H "authorization: Bearer $SKYWAKE_API_KEY" \
  -H "content-type: application/json" \
  -d '{ "retention_days": 30 }' >/dev/null

curl -sS --fail-with-body -X POST "$SKYWAKE_URL/v1/indexes/products/collect" \
  -H "authorization: Bearer $SKYWAKE_API_KEY"
