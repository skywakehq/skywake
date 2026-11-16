skywake upsert products products.jsonl

curl -sS --fail-with-body "$SKYWAKE_URL/v2/indexes/products/aggregate" \
  -H "authorization: Bearer $SKYWAKE_API_KEY" \
  -H "content-type: application/json" \
  -d '{ "group_by": "tag", "sum": "price", "min": "price", "filter": { "price": { "gt": 0 } } }'
