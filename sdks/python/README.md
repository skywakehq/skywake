# Skywake for Python

An open-source search index on your own bucket: vector, full-text and hybrid
search over rows you upsert, with filters, aggregates and branches. Python 3.10+.

```bash
pip install skywake
```

Set `SKYWAKE_API_KEY` (or run `skywake login`), then:

```python
from skywake import Skywake

sky = Skywake()

products = sky.index("products")
products.upsert({"id": 1, "text": "red running shoes", "price": 89})
hits = products.query("shoes for running", filter={"price": {"lt": 100}})

draft = products.fork("draft")
draft.update(1, {"price": 79})
draft.merge_into("main")
```

- **Settings.** `Skywake(key=..., url=..., environment=..., profile=...)`, else
  `SKYWAKE_API_KEY`, `SKYWAKE_URL`, `SKYWAKE_ENV` and `SKYWAKE_PROFILE`, else
  the profile `skywake login` saved. `AsyncSkywake` has the same methods, to
  `await`.
- **Indexes.** `sky.index(name)` calls no network; pass `branch="draft"` for
  another branch. `upsert`, `update`, `delete`, `get`, `query`, `count`,
  `aggregate` and `rows`. Rows are plain dicts. The first upsert creates the
  index. `list_indexes` and `create_index` live on the client.
- **Branches.** `fork(name, at=...)` returns a handle on the new branch and
  copies no data; `merge_into`, `branches`, `versions`, `restore` and
  `destroy` complete the set.
- **Errors** are `AuthError`, `PermissionError`, `NotFound`, `Conflict`,
  `MergeConflict`, `InvalidRequest`, `RateLimited` and `ServerError`, each with
  `code`, `message`, `hint` and `request_id`. Safe requests are retried.

The package also installs a `skywake` command that runs the CLI and the MCP
server (`uvx skywake mcp`) through `npx`, so it needs Node 18 or later.
