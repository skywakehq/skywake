v1() {
  curl -sS --fail-with-body "$SKYWAKE_URL/v1$1" \
    -H "authorization: Bearer $SKYWAKE_API_KEY" \
    -H "content-type: application/json" \
    -d "$2"
  echo
}

v1 /indexes '{
  "name": "passages",
  "schema": {
    "vectors": [],
    "attributes": [
      { "name": "text", "type": "text" },
      { "name": "terms", "type": "sparse" },
      { "name": "tokens", "type": "vectors" }
    ]
  }
}' >/dev/null

v1 /indexes/passages/branches/main/documents '{
  "documents": [
    {
      "id": 1,
      "attributes": {
        "text": "reset your password",
        "terms": { "indices": [12, 4071], "values": [0.5, 1.1] },
        "tokens": [[0.1, 0.4], [0.3, 0.2]]
      }
    },
    {
      "id": 2,
      "attributes": {
        "text": "change your card",
        "terms": { "indices": [12, 9002], "values": [0.2, 0.7] },
        "tokens": [[0.9, 0.1], [0.2, 0.2]]
      }
    }
  ]
}' >/dev/null

v1 /indexes/passages/branches/main/rank '{
  "score": { "dot": { "attribute": "terms", "indices": [12, 4071], "values": [0.8, 1.3] } },
  "topK": 10
}'

v1 /indexes/passages/branches/main/rank '{
  "score": { "max_sim": { "attribute": "tokens", "vectors": [[0.2, 0.3], [0.8, 0.1]] } },
  "topK": 10
}'
