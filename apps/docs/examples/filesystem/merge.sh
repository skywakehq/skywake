echo "retries = 3" | skywake write app/config.toml

skywake fork app agent-1
echo "export const ttl = 3600;" | skywake write app@agent-1/src/session.ts -m "Add sessions"
echo "retries = 5" | skywake write app@agent-1/config.toml

skywake diff app@agent-1
skywake merge app@agent-1 --dry-run
skywake merge app@agent-1 -m "Sessions from agent-1"
skywake log app --limit 3
