auth="authorization: Bearer $SKYWAKE_API_KEY"

curl -s -X POST "$SKYWAKE_URL/v2/environments" -H "$auth" \
  -H "content-type: application/json" -d '{"name": "prod"}'

curl -s "$SKYWAKE_URL/v1/environments/prod/store/trust" -H "$auth"
