echo "retries = 3" | skywake write app/config.toml

curl -sf -X PATCH "$SKYWAKE_URL/v1/namespaces/app/branches/main" \
  -H "authorization: Bearer $SKYWAKE_API_KEY" -H "content-type: application/json" \
  -d '{"protected": true}'

if echo "retries = 0" | skywake write app/config.toml; then exit 1; fi

skywake fork app agent-1
echo "retries = 5" | skywake write app@agent-1/config.toml
skywake merge app@agent-1
skywake read app/config.toml
