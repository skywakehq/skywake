skywake create disk app
made=$(skywake keys create --role write --only app --env default --name agent-1 --json)
key=$(jq -r .key <<<"$made")

echo hello | SKYWAKE_API_KEY=$key skywake write app/notes.md
SKYWAKE_API_KEY=$key skywake whoami

skywake keys
skywake keys revoke "$(jq -r .id <<<"$made")" --yes
