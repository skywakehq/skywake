skywake upsert articles articles.jsonl

curl -sS --fail-with-body "$SKYWAKE_URL/v1/indexes/articles/branches/main/hybrid" \
  -H "authorization: Bearer $SKYWAKE_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "searches": {
      "title": { "query": "password", "fields": ["title"], "topK": 50, "include": ["title"] },
      "text": { "query": "password", "fields": ["text"], "topK": 50, "include": ["title"] }
    },
    "topK": 5,
    "fuse": { "k": 60, "weights": { "title": 2 } }
  }'
