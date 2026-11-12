# Skywake MCP server

<!-- mcp-name: dev.skywake/skywake -->

Gives any MCP-capable agent its own branch of files, and vector, full-text and
hybrid search, on your own object storage. Add it to the agent's MCP config:

```json
{
  "mcpServers": {
    "skywake": {
      "command": "uvx",
      "args": ["skywake-mcp"],
      "env": {
        "SKYWAKE_URL": "http://localhost:8080",
        "SKYWAKE_KEY": "sw_...",
        "SKYWAKE_NAMESPACE": "prod/app",
        "SKYWAKE_BRANCH": "agents/42",
        "SKYWAKE_FORK_FROM": "main"
      }
    }
  }
}
```

Or install it with `pip install skywake-mcp` and run `skywake-mcp`.

Every setting is described in the [docs](https://skywake.dev/docs/agents/mcp).
Skywake is open source under the Apache License 2.0:
[github.com/skywakehq/skywake](https://github.com/skywakehq/skywake).
