skywake upload ./project app -m "first version"

skywake fork app agent-1
echo "port = 9090" | skywake write app@agent-1/config.toml -m "change the port"

skywake diff app@agent-1
skywake merge app@agent-1
skywake read app/config.toml
