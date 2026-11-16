skywake upsert products products.jsonl

curl -sS --fail-with-body "$SKYWAKE_URL/v1/indexes/products/branches/main/multi" \
  -H "authorization: Bearer $SKYWAKE_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "requests": [
      { "search": { "query": "shoes", "fields": ["text"], "topK": 5 } },
      { "aggregate": { "measures": { "total": ["count"] } } }
    ]
  }'
