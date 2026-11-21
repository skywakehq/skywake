# Skywake for Python

A client for Skywake: shared disks of files with branches, and search over them. Python 3.10+.

```bash
pip install skywake
```

Set `SKYWAKE_API_KEY` (or run `skywake login`), then:

```python
from skywake import Skywake

sky = Skywake()

app = sky.create_disk("app", search=True)
app.write("notes.md", "hello")
hits = app.query("greeting")
work = app.fork("agent-1")
work.write("notes.md", "changed")
work.merge_into("main")
```

- **Settings.** `Skywake(key=..., url=..., environment=..., profile=...)`, else
  `SKYWAKE_API_KEY`, `SKYWAKE_URL`, `SKYWAKE_ENV` and `SKYWAKE_PROFILE`, else
  the profile `skywake login` saved. `AsyncSkywake` has the same methods, to
  `await`.
- **Handles.** `sky.disk(name)` calls no network; pass
  `branch="agent-1"` for another branch. `fork(name, at=...)` returns a handle
  on the new branch, and copies no data.
- **Disks.** `read`, `write` (one file, or a dict of files as one commit),
  `delete`, `move`, `list`, `grep`, `find`, `query`, `log`, `diff`, `revert`,
  `restore`, `upload` and `download`.
- **Search.** Create a disk with `search=True`, or turn it on later with
  `configure(search=True)`, then `query(text, limit=..., path=...)` its files.
- **Errors** are `AuthError`, `PermissionError`, `NotFound`, `Conflict`,
  `MergeConflict`, `InvalidRequest`, `RateLimited` and `ServerError`, each with
  `code`, `message`, `hint` and `request_id`. Safe requests are retried.

The package also installs a `skywake` command that runs the CLI and the MCP
server (`uvx skywake mcp`) through `npx`, so it needs Node 18 or later.
