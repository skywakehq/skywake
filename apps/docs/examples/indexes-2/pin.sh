skywake upsert products products.jsonl

curl -sS --fail-with-body -X PATCH "$SKYWAKE_URL/v2/indexes/products" \
  -H "authorization: Bearer $SKYWAKE_API_KEY" \
  -H "content-type: application/json" \
  -d '{ "pinned": { "replicas": 2 } }' >/dev/null

curl -sS --fail-with-body "$SKYWAKE_URL/v1/indexes/products" \
  -H "authorization: Bearer $SKYWAKE_API_KEY"
