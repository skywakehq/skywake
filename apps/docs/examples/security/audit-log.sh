echo hello | skywake write app/notes.md

curl -s "$SKYWAKE_URL/v1/audit?limit=5" -H "authorization: Bearer $SKYWAKE_API_KEY" |
  jq -r '.events[] | [.at, .actor, .action, .outcome, .status] | @tsv'
