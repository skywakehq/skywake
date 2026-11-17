auth="authorization: Bearer $SKYWAKE_API_KEY"

skywake upsert products products.jsonl

curl -sf "$SKYWAKE_URL/v1/indexes/products/branches/main/search" -H "$auth" -H "content-type: application/json" \
  -d '{
    "query": "runing sho",
    "fuzzy": 1,
    "lastAsPrefix": true,
    "boosts": {"text": 2},
    "highlight": ["text"],
    "topK": 3
  }'
echo
