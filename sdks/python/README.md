# Skywake for Python

A client for Skywake: branches of a filesystem, and search indexes. Python
3.10+. The MCP server is its own package: `uvx skywake-mcp`.

```bash
pip install skywake
```

```python
import os

from skywake import Skywake

sky = Skywake("https://api.skywake.dev", os.environ["SKYWAKE_KEY"])

# Filesystems
main = sky.namespace("prod/app").branch("main")
fork = main.fork("agents/42")
fork.write({"notes.md": "# Plan"}, "Add the plan")
sky.namespace("prod/app").merge("agents/42", "main")

# Search indexes
products = sky.indexes.create(
    "prod/products",
    vectors=[{"name": "embedding", "dims": 3}],
    attributes=[{"name": "tag", "type": "string"}],
)
products.upsert([{"id": 1, "vectors": {"embedding": [0.1, 0.2, 0.3]}, "attributes": {"tag": "billing"}}])
hits = products.query("embedding", [0.1, 0.2, 0.3], top_k=5)
```

- **Branches.** `fork` copies nothing; `fork(name, at=commit)` starts at an
  older commit. `protect()` makes a branch change only by merge.
- **Files.** `list`, `read`, `write`, `commit`, `log`, `history`, `diff`.
- **Indexes.** `query`, `search` (BM25), `hybrid`, `order`, `rank`,
  `aggregate` and `multi`; `upsert`, `patch`, `delete` and `write`.
- **Errors** are `SkywakeError` with `status`, `code`, `request_id` and, for a
  bad field, its `path`. Safe requests are retried.
