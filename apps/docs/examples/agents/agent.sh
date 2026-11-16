echo "retries = 3" | skywake write app/config.toml

skywake fork app agent-1 --json
skywake download app@agent-1 ./agent-1 --json

echo "retries = 5" > agent-1/config.toml
echo "# Notes" > agent-1/NOTES.md

skywake upload ./agent-1 app@agent-1 -m "Raise retries" --json
skywake diff app@agent-1 --json
skywake merge app@agent-1 --json
skywake destroy app@agent-1 --yes --json
