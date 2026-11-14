# How Skywake works

The design in detail: the storage format, the mount, the API and running it yourself. The
[README](../README.md) is the short version.

## How it works

Everything lives in one bucket, and almost all of it is immutable.

```
chunks/<blake3>          file content, split at content-defined boundaries
objects/<blake3>         commits, and packs of trees (directories)
refs/<branch>            the branch head: its current commit
```

Chunks and objects are compressed with zstd, named by the BLAKE3 hash of
their uncompressed bytes, and checked against that hash on every read.

- **Chunks.** Files are cut with FastCDC (256 KiB / 1 MiB / 4 MiB min / avg / max)
  and named by their BLAKE3 hash. Boundaries follow the content, so changing
  one byte of a large file adds a chunk or two, and identical data is stored
  once across every file and every branch.
- **Trees.** A directory is a sorted map of names to files, directories and
  symlinks, named by the hash of its encoding. Equal directories have equal
  hashes, so diffing two branches skips every directory that didn't change.
  Trees travel together: a commit carries its newest trees itself, and the
  rest sit in packs of up to 1 MiB, each a folder and what is under it. A
  mount fetches the pack holding the root, and any other pack only when a
  folder in it is first opened, so mounting a million-file store is as fast
  as mounting an empty one. A folder too large for that (thousands of
  files) is stored in parts of about 256 names each, cut where a name's
  hash says, so changing one file in a folder of a million rewrites one
  part, not the folder. Saves pack only what changed; once those new
  packs add up to more than the last full repack, the next save repacks
  every tree, so old branches stay as quick to open as new ones.
- **Branches.** The only mutable state: one object per branch, holding its
  head commit. Moving a branch replaces it with a write that succeeds only
  if nobody replaced it since it was read (`If-Match`), so when two writers
  race from the same head, exactly one wins and the other gets a conflict.
  That conditional write is all the coordination there is; it needs nothing
  but S3. A write whose answer got lost (a timeout, or a retry that found
  its own first try) is settled by reading the head back. Deleting a
  branch is a conditional write too: it replaces the head with an empty
  object, so a delete never erases a commit that landed after it looked.
- **Garbage collection.** `skywake delete` removes a branch; `skywake gc`
  deletes every chunk, pack and commit that no branch or commit history
  can reach. It spares anything younger than a grace period (eight days
  by default), so a save that has uploaded its data but not yet moved its
  branch, or a part uploaded for a commit still to come, is never touched.
  It also keeps what a branch deleted within the grace period reached, and
  everything any commit younger than the grace period reaches. It deletes
  commits first, then packs, then chunks, so a collection that stops
  halfway never leaves a commit without its data (it may leave one
  without its parent; that history then starts there). It deletes in
  batches, checks each object again just before, and marks its lock
  while a batch runs. Every save, commit, merge, fork or copy checks that
  mark before it moves a branch: it waits for a running batch (a few
  seconds, never the whole collection), and if a batch ran since it
  began, checks that what it stored is still there and otherwise stores
  it again or fails. So writing the same bytes as old garbage never
  loses them. A fork or copy of an old commit by hash, or a file made
  from old chunks, first writes that object again so it stays young. A
  missing commit or pack is reported and skipped rather than stopping
  every later collection. Collection needs delete rights on the whole
  bucket, so it runs with the server's keys, not with namespace
  credentials.
- **Few requests in a row.** On real S3 each request takes 10–50 ms, so
  what matters is how many wait on each other. A fork is 2 (read the head,
  write the new one), a mount 2 (read the head, then claim it and fetch the
  trees at once), and a save of small files 2 (read the collection lock,
  write the head).
- **Commits.** Checkout restores each file's timestamp, and a commit reuses
  any file whose size, timestamp and mode match the previous commit, so an
  agent's commit only reads the files it touched. (A tool that edits a
  file in place, keeps its size and sets its old time back goes unseen;
  the inode's change time would catch it but cannot be restored, so every
  checkout would make the next commit read everything.) Checkout never
  writes outside its folder: unsafe names are refused, and every file is
  created new, so nothing follows a symlink.
- **Build output and caches stay out.** Commits skip what `.skywakeignore`
  lists, one rule per line. A plain name such as `__pycache__` matches in
  any folder; a rule with a `/` such as `/target` is a path from the root.
  Without the file, Skywake skips `/target`, `/node_modules`, `/.venv` and
  tool caches (`__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`,
  `.DS_Store`). They are large or noisy, can be rebuilt and belong to one
  machine. `.git` is kept, so agents can use git inside a fork. A
  `.skywakeignore` that is not a plain file, such as a symlink, counts as
  missing. In a mount, ignored folders such as `target` live on local disk
  and belong to the mount's owner; they are not kept after an unmount.
  A mount's saves skip only what is made in the mount: a folder or file the
  branch already holds under an ignored name, such as a committed
  `.DS_Store`, stays in the branch as it was. Changes to it stay in the
  mount.

### Files and search in one bucket

A search index is built on the same storage engine: it keeps `refs/`,
`objects/` and `chunks/` too, plus `blobs/` for its segments. The two share a
bucket, never a folder:

```
<bucket>/<prefix>/fs/ns_…/        a namespace (in the hosted store: <org>/ns_…)
<bucket>/<prefix>/ix/ix_…/        an index    (in the hosted store: <org>/indexes/ix_…)
```

- **Each folder says its kind.** `skywake.json` (`{"kind": "filesystem" |
  "index"}`) is written when the folder is made: by the first branch made
  from nothing, or by the index's creation. Both garbage collectors read it
  first and stop on a folder of the other kind, or one holding both. A GC
  sweeps what no root it knows reaches, and it knows only its own kind's
  roots, so one run on the wrong folder would delete everything. A folder
  made before the marker is judged by what only one kind writes
  (`commits/`, `bundles/`, `moved/` against `blobs/`, `shards/`) and marked
  then. Scoped credentials may not write the marker.
- **Linked indexes follow branches.** A namespace may link one index. Each
  linked branch has a row in Postgres saying which commit its index branch
  matches and whether it is behind. Commits through the API mark it due at
  once; saves are marked due 30 seconds on (`/advanced`), and a branch
  nobody marks is still read every 5 minutes, since most saves are written
  straight to the bucket. Every API server claims due rows with
  `FOR UPDATE SKIP LOCKED` (a 60-second lease, renewed while it works; at
  most 4 per organization at once), diffs the two commits' trees and writes
  only the files that changed. A claim clears the row's mark, so a save
  during a sync marks it again rather than being lost. Each sync records
  which index version matches which commit, and a branch forked with its
  index starts from such a version: any one is right, since the diff is
  between trees, not history.
- **Deletes are queued.** Deleting a namespace or an index removes its row
  and queues its folder in one SQL statement, and a worker on every server
  deletes queued folders until they are empty. Nothing is left in the
  bucket by a crash between the two.
- **A customer's bucket.** An environment may keep its data in a bucket its
  owner brings, reached through a role Skywake assumes (with an external
  ID) or through keys sealed with AES-256-GCM. Its namespaces and indexes
  have the region `bucket:<org>/<environment>`, and the bucket can't change
  while the environment holds data.

## The mount

On Linux, `skywake mount agent-37 /work` serves a branch as a folder,
without downloading it first. Mounts are run by `skywaked`, one daemon per
machine; `skywake` sends it requests over a Unix socket. Every folder's
listing arrives with the mount, and files are read chunk by chunk through a cache on
local disk, a couple of chunks ahead of the reader. The first write to a
file copies it to local disk (truncating it, as `O_TRUNC` does, copies
nothing); once saved and left alone for 30 seconds, it goes back to being
read from the cache, and its local copy is deleted.

- **Autosave.** Every 2 seconds the daemon saves what changed in each
  mount: it uploads the changed files and builds new trees for the changed
  folders straight from memory, then advances the branch. These saves are
  commits marked as autosaves, which `skywake log` hides. Each mount saves
  on its own timer, so one slow mount never holds up another. Before each save
  the kernel hands over every write it still holds, including writes
  through `mmap`, so a crash loses at most the last 2 seconds (plus the
  save in flight); whatever the daemon
  couldn't save is kept in `unsaved/` with a manifest of paths and content,
  and `skywake recover <folder> <new-branch>` commits it as a fork of the
  mount's branch. `skywake status` shows each mount's save lag, unsaved
  bytes and last error.
- **Each save is one instant.** A save stores the mount exactly as it was
  when the save started, even while files keep changing during the upload:
  writes to a file being uploaded go aside until its upload is done. So a
  branch never holds a file half old, half new, or a git ref without the
  object written before it.
- **`fsync` means saved.** `fsync` on any file in a mount returns only
  once everything written so far is in the bucket, so a database, a
  package manager or an agent that syncs what it must not lose loses
  nothing, even to `kill -9`. Every `fsync` that arrives during a save is
  answered by the next one, so many writers syncing at once share saves.
  `fsync` on a folder does the same, so a rename followed by a folder
  `fsync` lasts. `skywake sync /work` does the same for a whole mount.
- **Small files** (under 4 KiB) are stored inside their folder's tree, and
  new trees travel inside the branch head, so a save of only small files
  is a single request.
- **Commits.** `skywake commit agent-37 /work -m "..."` saves the mount
  the same way, as a named commit.
- **Unmounting.** `skywake unmount` unmounts first and then saves the last
  changes from memory, so no write can slip in after the last save. If a
  process still uses the folder, the unmount fails and the mount stays,
  still saving. When `skywaked` stops, it unmounts all mounts at once; a
  mount still in use is detached instead and goes away once no process
  uses it.
- **Moving a branch.** Mounting a branch claims it: the daemon rewrites the
  head with the same commit, which changes the object. The old mount finds
  out at its next save, or within 5 seconds when idle (one small read of
  the head), so it can never overwrite the new owner, and turns read-only
  at once: writes fail with `EROFS`. `skywake mounts` shows it as moved.
  Changes it had not saved are kept for `skywake recover`, never deleted.
  Unmount first and the move loses nothing.

Ignored paths are symlinks to directories on local disk, so a build's
output never goes through FUSE at all. Writing gigabytes of it through the
mount made builds a third slower; through the link they run at disk speed.
Only rules that name plain folders inside the mount are linked: a rule
with `..`, or one that passes through a symlink, stays on the mount.

Writes go through the kernel's write cache, which gathers small writes
into large ones, and each save first waits until the kernel has sent
every write it holds. Counting the final `fsync`, writes of 4 KiB run at
about 530 MB/s (105 MB/s without the cache), and writes of 1 MiB at about
575 MB/s.

The mount passes pjdfstest, the POSIX filesystem test suite
(`scripts/pjdfstest.sh`). A branch stores names, contents, permission bits
(`chmod 600` survives a save and a new mount), modification times and
symlinks. Some things live only as long as the mount:

- **Hard links** are one file while mounted; a save stores each name as a
  file with the same content, so after the next mount they are separate.
- **Owners, access times and extended attributes** are kept in memory.
  Files of the branch belong to the mount's owner; new files to whoever
  makes them. `system.*` attributes such as ACLs are refused.
- **FIFOs, sockets and devices** work, but saves skip them.

Inode numbers come from each file's path, so they stay the same across
mounts and git doesn't read the whole tree again after a remount. Listing
a folder while deleting from it, as `rm -rf` does, skips nothing.

## For agents and orchestrators

Agents that do not mount use the HTTP API through the Python or
TypeScript SDK or the MCP server. All three follow one OpenAPI spec
([`packages/contract/generated/openapi.json`](../packages/contract/generated/openapi.json)),
written from the same contract the server is built on. The SDKs retry
rate-limited and failed requests when that is safe, time out, and raise
errors that carry the API's `code` and `request_id`. A delete retried after
a failure that may have landed counts a 404 as done. Both read a large
file as a stream (`readStream`, `read_stream`); a timeout limits the wait
for an answer, never the reading of a long one. Long lists (branches,
folders, file history, diffs, sessions, claims) come in pages of up to
1,000: each list method takes `limit` and `after` (the last item's name,
path, hash or id). To get every item, `allBranches()`, `allEntries(path)`
and the other `all…` methods in TypeScript, and `iter_branches()`,
`iter_entries(path)` and the other `iter_…` methods in Python, follow the
pages for you.

```python
from skywake import Skywake

sky = Skywake("http://localhost:8080", key)
namespace = sky.namespace("prod/app")
with namespace.session("agent-42") as session:
    fork = namespace.branch("main").fork("agents/42")
    fork.claim("src/auth", session.id)
    fork.write({"src/auth/login.py": code}, "fix login", session.id)
    result = fork.merge_into("main", session=session.id)
    print(result.conflicts or result.head)
```

- An **organization** holds **namespaces** such as `prod/app` and
  `staging/app`. Each namespace is its own folder of the bucket, so data is
  shared (stored once) inside a namespace and never across them.
- **API keys** belong to an organization and reach only the namespaces
  their pattern allows (`prod/*`), as `read`, `write` or `admin`, with an
  optional expiry. Keys look like `sw_...` and end in a checksum, so secret
  scanners can spot a leaked one. The console's sign-in tokens (JWTs) work
  too. Every call goes into a tamper-evident audit log.
- **Credentials for one namespace**: with an STS role configured,
  `POST /v1/namespaces/{namespace}/credentials` hands a daemon or the CLI
  S3 credentials that reach only that namespace's folder, for 15 minutes.
  They cannot delete objects, move a protected branch, or take garbage
  collection's lock. They can still overwrite other branches, content and
  `deleted/` records in that namespace; content is checked against its
  hash, so damage is noticed rather than silent. Credentials already handed
  out keep working until they expire, so protecting a branch reaches them
  only then (900 seconds by default).
- **Files over HTTP**: list, read (or a byte range), search with a regular
  expression, and commit a set of writes and deletes at once.
- **Merge** is three-way against the newest commit both branches came
  from. Text files merge line by line, and a file's mode merges on its
  own; changes that overlap are reported per file and nothing is saved.
  Merges into one branch take turns, like a queue. A commit of files
  retries when another writer moved the branch, but fails instead if that
  writer changed one of the same paths.
  **Protected** branches change only by merge, and only an `admin` merges into them.
- **Sessions** are agents at work: they send heartbeats and end when they
  stop. Commits record their session. **Claims** say "this session is on
  `src/auth`" so others can pick other work; they are advice, not locks.
- The **change feed** lists what each commit touched since a given one.
- `skywake mount --read-only` mounts a branch for reading without claiming
  it, so any number of readers can share it with one writer, and
  `--fork NAME` forks before mounting.

[e2e/swarm/](../e2e/swarm) runs 100 agents that fork, work and merge.

## Running it

To run the API and the web console on your own machine or servers, see
[docker/README.md](../docker/README.md):

```bash
scripts/setup.sh        # makes .env, the only settings file, with every secret filled in
docker compose up -d    # the console on localhost:3100, the API on :8080
```

To run it in your own cloud account on Kubernetes, with the API scaling
with the load, see [deploy/helm/skywake/README.md](../deploy/helm/skywake/README.md).

A local directory works as a store out of the box (`.skywake` by default).
For S3, start the bundled S3-compatible server and point Skywake at it:

```bash
docker compose -f docker/dev/compose.yaml up -d
export SKYWAKE_STORE=s3://skywake AWS_ENDPOINT=http://localhost:9100 AWS_ALLOW_HTTP=true \
       AWS_ACCESS_KEY_ID=skywake AWS_SECRET_ACCESS_KEY=skywake-dev AWS_REGION=us-east-1
cargo run -p skywake-cli -- new main
```

Any S3 that supports conditional writes (`If-None-Match` and `If-Match`)
works: AWS S3, Cloudflare R2, RustFS and others. Skywake checks this once
before its first conditional write and refuses a store that ignores them.
`s3://bucket/folder` keeps a store in one folder of a bucket.
`skywake://<namespace>` asks the API (`SKYWAKE_API_URL`, `SKYWAKE_API_KEY`)
for short-lived credentials that reach only that namespace, and renews
them before they end: `write` ones, or `read` with `SKYWAKE_STORE_ACCESS=read`.

To mount branches, run `skywaked` (Linux, as root for the best write speed)
with the same store settings. It keeps its socket, chunk cache and the
mounts' local files in `/var/lib/skywake` (as root) or
`~/.local/state/skywake`, or `SKYWAKE_ROOT`. The folder must belong to the
user running `skywaked`, who alone (with root) may use its socket; with
`SKYWAKE_GROUP=<group>`, members of that group may too, but only to mount
over folders they own and manage their own mounts. Their VM sockets,
build folders and kept unsaved changes belong to them, and only they can
use their mounts unless they pass `--allow-other`; no member can sync,
commit, unmount or list another's mount.

Which branches each member may read or write is set in an access file,
`access` in the daemon's folder or `SKYWAKE_ACCESS=<path>`:

```
# who         how    which branches
user:ann      write  agents/*
group:ci      read   *
```

`write` includes `read`; `prod/*` matches `prod/x` but not `production`,
as in API key scopes. A member may do what any line for them or one of
their groups allows: mount read-only needs `read`, a writable mount or a
commit `write`, `new --from` and `merge` need `read` on the source and
`write` on the target, `delete` and `recover` need `write`. Root and the
daemon's user may do anything. The file must belong to root (or the
daemon's user) and be writable by no one else, or `skywaked` won't start.
Edits apply to the next request; an edit that can't be read is logged
and the last good rules stay. A mount keeps the access it was mounted
with until it is unmounted. Without the file, every member may use every
branch, and `skywaked` says so when it starts.

The rules hold only if members can't reach the store themselves, so
give them no store keys: without `SKYWAKE_STORE`, `skywake new`, `merge`,
`delete` and `recover` go through `skywaked`, to its store, and
`mount --fork` always does. Members read other branches by mounting them
read-only. With a `skywake://` store, a better path is for each member
to use their own API key, so the API applies its own scopes; `skywaked`
does not do that yet. Cached chunks are checked against their hash before use, so a bad
file on disk is fetched again rather than served.

Limits: a `.skywakeignore` over 64 KiB is not read (the default rules
apply) and only its first 1,000 rules count; a member may have 16
requests open at once. Unsaved changes are stored by the daemon's user,
so with a root `skywaked` they are not counted against a member's disk
quota. Instead each mount may keep at most 20 GiB on the daemon's disk
(`SKYWAKE_MOUNT_LOCAL_GB`, 0 for no limit): changes not saved yet, and
saved files whose local copy is not freed yet. Near the limit, saved
copies are freed at once; past it, writes fail with "no space left on
device" until a save lands or files are deleted. Keep the daemon's folder
on a filesystem with room for every mount's limit.

`skywaked` and `skywake-cache` log to stderr: `SKYWAKE_LOG` filters (for
example `debug`, default `info`) and `SKYWAKE_LOG_FORMAT=json` writes JSON
lines. With `SKYWAKE_METRICS_LISTEN=127.0.0.1:9464` they serve Prometheus
metrics at `/metrics`, such as `skywake_save_lag_seconds{mount}` (alert on
it), `skywake_save_failures_total` and `skywake_cache_hits_total`.

For a VM sandbox, `skywake mount <branch> /run/vm.sock --vm` serves the
branch on a vhost-user socket instead of a folder. Point the hypervisor
at it (QEMU: `-chardev socket,id=fs,path=/run/vm.sock -device
vhost-user-fs-pci,chardev=fs,tag=skywake`, with shared guest memory) and
mount it inside with `mount -t virtiofs skywake /mnt`. Every VM on the host
then shares one daemon and one chunk cache.

With many machines reading the same data, run `skywake-cache` on a few of
them (fast local disk, private network, same store settings, and
`SKYWAKE_CACHE_LISTEN=<private address>:7070`) and give every `skywaked`
the list: `SKYWAKE_CACHE_NODES=http://10.0.0.5:7070,...`. Nodes and
daemons share a secret, `SKYWAKE_CACHE_TOKEN`, sent as a bearer token; a
node refuses to start without one unless given `--insecure`. Each chunk
then leaves the bucket once for the whole fleet. Mounts check every chunk
a node sends against its hash. A node that is down or slow (no answer
within half a second) costs one short wait, then is skipped for a while
and the bucket read instead, so a node can never make a mount wrong, only
faster.

For the API, run `node apps/api/src/main.ts` (Node 22.18 or later,
after `pnpm install` and `pnpm --filter @skywake/engine build`) with a
Postgres database (`SKYWAKE_API_DATABASE`), the store (`SKYWAKE_STORE`) and an
admin token (`SKYWAKE_API_ADMIN_TOKEN`). `POST /v1/orgs` with the admin token
creates an organization and returns its first admin key; everything else
uses keys. `GET /v1/openapi.json` describes every route. To accept the
console's sign-in tokens, set `SKYWAKE_API_JWKS_URL`, `SKYWAKE_API_JWT_ISSUER`
and `SKYWAKE_API_JWT_AUDIENCE`. Every setting lives in one `.env` at the root
(`scripts/setup.sh` makes it; `.env.example` lists them all), and
[apps/api/README.md](../apps/api/README.md) explains the API's. `docker compose -f docker/dev/compose.yaml up -d` starts
Postgres and S3 locally.

```bash
cargo test
pnpm build                   # every package, through Turborepo
pnpm typecheck               # also: pnpm lint, pnpm test
pnpm dev                     # the web console on localhost:3100, with the API and zero-cache
pnpm dev:all                 # everything on localhost:3000: the site, /docs and /dashboard
pnpm e2e                     # conformance tests, against a running API (SKYWAKE_API, SKYWAKE_ADMIN)
e2e/swarm/run.sh             # 100 agents fork, work and merge, with pnpm dev running
scripts/format.sh            # rustfmt, ruff and Prettier; --check to only check
scripts/openapi.sh           # after changing a route: rebuild the spec and TypeScript types
scripts/bench.sh micro --quick   # benchmarks: micro, index, filesystem, pinning, cloud
scripts/vm-test.sh           # a VM mounting a branch over virtio-fs, after a release build
scripts/pjdfstest.sh         # the POSIX test suite on a FUSE mount, on Linux
scripts/shell.sh scripts/crash-loop.sh   # kill -9 skywaked mid-save, again and again; check what survives
```

The console (`apps/console`) is a Next.js app. People sign in with Better
Auth (passwords, passkeys, two-factor) and work in organizations. A sync
engine, [Zero](https://zero.rocicorp.dev), copies the organization's
branches, commits, sessions and activity from the API's Postgres into each
browser and keeps them current, so the fork tree, merges and activity
update as agents work. An environment opens on a table of its
filesystems. The console groups namespaces, which it calls filesystems, into environments by the first part of the name:
`prod/app` is the filesystem `app` in `prod`. Changes go through Zero to the API, signed as the
person making them; file contents and diffs are read from the API when
needed. Postgres needs `wal_level=logical` (the bundled one has it).

[benchmarks/README.md](../benchmarks/README.md) explains the benchmarks, and
[benchmarks.md](benchmarks.md) lists the published numbers and how each was made.
