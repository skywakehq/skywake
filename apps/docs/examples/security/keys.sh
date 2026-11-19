echo '{"id": 1, "text": "red running shoes"}' | skywake upsert products -
made=$(skywake keys create --role write --only products --env default --name agent-1 --json)
key=$(jq -r .key <<<"$made")

echo '{"id": 2, "text": "waterproof hiking boots"}' | SKYWAKE_API_KEY=$key skywake upsert products -
SKYWAKE_API_KEY=$key skywake whoami

skywake keys
skywake keys revoke "$(jq -r .id <<<"$made")" --yes
