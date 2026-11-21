# Skywake for TypeScript

A client for Skywake: disks your agents share, with branches and search.

```bash
npm install skywake
```

The `skywake` package holds this SDK, `skywake/bash` and the `skywake` command.
`@skywake/sdk` is the SDK alone, for when you want nothing else.

```ts
import { Skywake } from "skywake";

const sky = new Skywake();

const app = await sky.createDisk("app", { search: true });
await app.write("notes.md", "# Plan");

const work = await app.fork("agent-1");
await work.write("notes.md", "# Plan, changed");
await work.mergeInto("main");

const hits = await app.query("where is the plan");
```

- **Files.** `read`, `write`, `delete`, `move`, `list`, `stat`, `grep`, `find`,
  `upload` and `download` for a whole folder.
- **Branches.** `fork` copies nothing; `fork(name, { at })` starts at an older
  commit. `mergeInto`, `diff`, `log`, `revert` and `restore`.
- **Search.** With search on, `query` finds files by meaning and keywords.
- **Errors** are `SkywakeError`s such as `NotFound` (with a `hint`),
  `PermissionError` and `MergeConflict` (with its `conflicts`). Safe requests
  are retried.
