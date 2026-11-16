auth="authorization: Bearer $SKYWAKE_API_KEY"

curl -sf "$SKYWAKE_URL/v2/indexes/products/rows" -H "$auth" -H "content-type: application/json" \
  -d '{"id": 1, "text": "red running shoes", "version": 3}'
echo

curl -sf "$SKYWAKE_URL/v1/indexes/products/branches/main/write" -H "$auth" -H "content-type: application/json" \
  -d '{
    "upserts": [{"id": 1, "attributes": {"text": "red running shoes", "version": 4}}],
    "upsertIf": {"version": {"lt": {"$ref_new": "version"}}}
  }'
echo
