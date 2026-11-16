auth="authorization: Bearer $SKYWAKE_API_KEY"
org=$(curl -s "$SKYWAKE_URL/v2/whoami" -H "$auth" | jq -r .organization)

curl -s -X PUT "$SKYWAKE_URL/v1/orgs/$org/ip-allowlist" -H "$auth" \
  -H "content-type: application/json" -d '{"cidrs": ["127.0.0.0/8", "203.0.113.0/24"]}'

curl -s "$SKYWAKE_URL/v1/orgs/$org/ip-allowlist" -H "$auth"

curl -s -X PUT "$SKYWAKE_URL/v1/orgs/$org/ip-allowlist" -H "$auth" \
  -H "content-type: application/json" -d '{"cidrs": []}'
