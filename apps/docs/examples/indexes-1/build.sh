auth="authorization: Bearer $SKYWAKE_API_KEY"

skywake upsert images images.jsonl

curl -sf -X POST "$SKYWAKE_URL/v1/indexes/images/branches/main/build" -H "$auth"
echo
curl -sf -X POST "$SKYWAKE_URL/v1/indexes/images/branches/main/warm" -H "$auth"
echo
curl -sf "$SKYWAKE_URL/v1/indexes/images/branches/main/recall" -H "$auth" -H "content-type: application/json" \
  -d '{"queries": 3, "topK": 2}'
echo
