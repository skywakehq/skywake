# Roadmap

Where Skywake is going, in phases. Each phase ends with something you can
run and a number it has to hit. A phase is done when its exit test passes,
not when its checklist is ticked.

## Where it ends

```
 Web console ──┐        Agents (SDK · MCP · CLI)
               ▼                 ▼
        ┌──────────── Control plane (stateless API) ────────────┐
        │ orgs · namespaces · keys · merges · sessions · feed    │──► Postgres
        └──────────────────────────┬─────────────────────────────┘
                                   │
 ┌──────────── Host (runs many agent sandboxes) ────────────┐
 │ sandbox ─ FUSE / virtio-fs ─┐                             │
 │ sandbox ─ FUSE / virtio-fs ─┼─► skywaked                    │
 │ sandbox ─ FUSE / virtio-fs ─┘   local branch metadata     │
 │                                 NVMe chunk cache          │
 │                                 background flush to S3    │
 └──────────────────────────┬────────────────────────────────┘
                            │ cache misses, commits
             ┌──────────────▼──────────────┐
             │ Regional chunk cache tier   │  merges duplicate fan-out reads
             └──────────────┬──────────────┘
             ┌──────────────▼──────────────┐
             │ S3 / R2 / RustFS            │  the only source of truth
             └─────────────────────────────┘
```

Three rules carry through every phase:

1. **The bucket is the truth.** Every cache, index and database can be
   rebuilt from it, except the control plane's organization data, which is backed
   up into the same bucket.
2. **One writer per branch.** Collaboration happens by fork, watch and
   merge, never by two machines writing the same files. This is what lets
   metadata stay local and fast.
3. **Coordination is one conditional write.** Moving a branch head is the
   only point where writers meet.

## Phase 0: Foundation ✅

The data model that is hard to change once data exists: content-defined
chunks, Merkle trees, commits, branch heads moved by create-if-absent
writes, fork, diff, log, a CLI, and S3 support.

## Phase 1: Fast core ✅

Make the existing paths as fast as the network allows, and start measuring.

- Upload and download chunks in parallel, with bounded concurrency.
- Skip unchanged files on commit by checking size and modified time against
  the previous tree, so a re-commit only reads what changed.
- A head hint object per branch, so finding a head is one read, not a
  listing of its whole history.
- Move blocking file I/O off the async runtime.
- Binary encoding for trees and commits, and zstd compression for chunks.
  Bump a format version byte now, before anyone has data.
- `benchmarks/`: a harness that times real workloads (`git clone`, `npm install`,
  test runs, commit, checkout) against any directory or store and writes
  the results to a file.

**Exit test:** committing a 1 GB tree to the local S3 server runs at least
at 80% of what `aws s3 cp --recursive` achieves; re-committing it unchanged
takes under a second; finding a head stays constant as history grows.

**Result:** passed. Commit ran at 171% of `aws s3 cp` (77 vs 45 MB/s),
an unchanged re-commit took 119 ms, and a head lookup is two reads. Chunks
grew to a 1 MiB average along the way: at 64 KiB, per-request overhead held
commits to 73% of the baseline.

## Phase 2: The mount (4–6 weeks) ✅

The phase that turns storage into a filesystem. Development moves into a
Linux VM (Colima already provides one).

- Read-only FUSE mount of any commit, reading chunks only when touched.
- A content-addressed chunk cache on local disk. Chunks never change, so
  the cache never needs invalidating, only eviction.
- Prefetch: record which chunks a workload reads at startup and fetch them
  in the background next time.
- Writable mounts. The branch's metadata (inodes, directories, sizes) lives
  in a local embedded database owned by its one writer; new file data is
  written locally and chunked on commit.
- `skywake mount agent-37 /work`, `skywake commit` from a live mount.
- POSIX correctness against pjdfstest, for the subset agents need: renames,
  hard links, symlinks, permissions, `fsync`, `mmap`.

**Exit test:** a fork of a 20 GB environment is usable in under 100 ms;
with a warm cache, `git status`, `npm install` and `npm test` run within
20% of local disk.

✅ **Done** (run `20261105-121157-mount`, in [docs/benchmarks.md](docs/benchmarks.md)). A fork mounts in
5–7 ms whatever its size; warm, `git status` takes 6 ms and reading every
file 13 ms; a full `cargo build` of this repository runs at 106% of local
disk. The build test uses cargo instead of npm, and a 1 GB tree instead of
20 GB, to fit the dev VM.

What changed from the plan:

- Build output (`target`, `node_modules`, `.venv`, or whatever
  `.skywakeignore` lists) is linked to local disk instead of written through
  FUSE, and commits skip it. Through FUSE, builds ran a third slower. Tool
  caches such as `__pycache__` are skipped by commits in any folder but stay
  on the mount.
- Branch metadata lives in memory for the life of the mount rather than in
  an embedded database; it moves to the daemon in Phase 3.
- Still open: chunk cache eviction, prefetch from access traces, FUSE
  passthrough for edited files, and the pjdfstest run.

## Phase 3: The daemon and durability (3–4 weeks) ✅

One process per host that serves many sandboxes and survives crashes.

- `skywaked`: one daemon per host managing many branch mounts, sharing one
  chunk cache across all of them.
- Background flush: metadata changes stream to the bucket as a numbered
  log of batched writes, so the bucket is never more than a configurable
  window behind.
- Crash recovery: replay the local log on restart; after a host is lost,
  rebuild from the bucket and report exactly what fell inside the window.
- Branch leases with fencing, so a branch can move to another host and the
  old writer is shut out even if it comes back.
  **Exit test:** `kill -9` a busy host and lose nothing older than the flush
  window; move a running branch between two hosts with no lost writes.

✅ **Done** (run `20261105-125604-daemon`, in [docs/benchmarks.md](docs/benchmarks.md)). After `kill -9`, nothing older
than the 2-second save window was lost: the oldest lost write was
written 1.93 s before the crash. A planned move between two daemons takes
35 ms with nothing lost; a takeover shuts the old machine out at its
next save, and from then on it refuses writes.

What changed from the plan:

- Each mount is saved as a whole snapshot of what changed every 2 seconds,
  built from the mount's memory, instead of as a log of individual
  changes. Only changed files are uploaded and only changed folders get new
  trees, so a save of a few files takes tens of milliseconds. These saves
  are commits marked as autosaves, which `log` hides. A log of changes
  stays possible later if 2 seconds turns out to be too long.
- Files under 4 KiB are stored inside their folder's tree instead of as
  chunks, so a save of many small files makes one request per folder, not
  one per file.
- There is no separate lease. Mounting a branch claims it by rewriting its
  head; the old owner's next save then finds the head changed, and its
  mount turns read-only.
- After a crash, the daemon moves what it couldn't save to `unsaved/`
  and reports it, rather than replaying it into the branch: the branch may
  have moved on since.
- `fsync` and `skywake sync` return only once the write is in the bucket,
  so synced writes survive any crash; saves for many writers are shared.
- virtio-fs moved to Phase 4, next to the other work for many hosts.

## Between phases: fewer requests in a row

Real S3 answers each request in 10–50 ms, and the benchmark with 20 ms of
added latency showed forks, mounts and saves waiting on chains of 4–6
requests. Now:

- A branch is one object holding its head commit, moved with a write that
  checks nobody moved it first (`If-Match`). Reading a head is one request.
- A commit's trees travel together: its newest ones inside the commit,
  the rest in packs of up to 1 MiB, each a folder and what is under it. A
  mount fetches only the root's pack; other packs come as folders open.
  Still to do: merge older packs in the background, so deep folders in
  long-lived branches stay one request away.
- Autosaves live only in the branch head, so a save of small files is one
  write.
- The daemon saves its mounts side by side instead of one at a time.

A fork is now 2 requests in a row, a mount 2, a small save 1.

## Phase 4: Distributed scale (6–8 weeks)

Thousands of agents, many hosts, very large trees.

- ✅ Control plane: a stateless API server backed by Postgres for tenants,
  auth, the branch catalog and leases. Branch heads stay in the bucket.
  the API; each tenant's data is a folder of the bucket. Next: the
  change feed, and mounts taking leases themselves.
- ✅ Regional chunk cache tier that merges identical in-flight requests, so a
  thousand forks starting at once cause one read per chunk, not a thousand.
  `skywake-cache` nodes, found by rendezvous hashing; mounts check every byte
  and read the bucket when a node is down. Next: warming a working set
  ahead of the agent, and a second node per chunk for hot spots.
- ✅ Metadata index for huge trees. Packs of up to 1 MiB, each a folder and
  what is under it, fetched as folders open, and repacked whole once new
  packs outgrow the last repack. A folder two levels down in a
  200,000-file tree costs at most 3 reads cold, and a warm lookup is a map
  read.
- ✅ virtio-fs transport so microVM sandboxes (Firecracker, Cloud Hypervisor)
  share the host cache without running FUSE inside each VM.
  `skywake mount --vm` serves a branch on a vhost-user socket;
  `scripts/vm-test.sh` boots a VM under QEMU and checks reads, writes, `fsync`
  and renames end to end. Next: DAX for large reads, more request queues.
- ✅ Garbage collection: mark everything reachable from branch heads and
  their history, sweep the rest after a grace window so in-flight writers
  are never collected. `skywake delete` and `skywake gc`; the fleet
  benchmark collects over and over while agents write, then checks every
  branch byte for byte.

**Exit test:** 1,000 forks cold-start from one base image across several
hosts with the bucket seeing roughly one read per chunk; `stat` on a
10-million-file tree in under 5 ms warm; GC runs during a write-heavy
benchmark and every branch still checks out byte-for-byte.

## Phase 5: The agent interface (3–4 weeks) ✅

Make Skywake something agents and orchestrators use directly.

- ✅ Organizations and namespaces. An organization holds namespaces with
  path names (`prod/app`, `staging/app`); each namespace is its own folder
  of the bucket, so it is also the unit of dedup and garbage collection. It
  records a region, chosen when it is created. Branch names may hold `/`
  (`agents/fix-1`). Organizations replace the earlier tenants.
- ✅ One public API, under `/v1`. Its routes are a Zod contract
  (`packages/contract`) that both the server and the OpenAPI spec
  (`GET /v1/openapi.json`) come from; the SDKs, MCP server and console are
  clients of it. The server runs on Node over the Rust engine, loaded
  through N-API, so all file logic stays in one place.
- ✅ Access: API keys scoped to an organization and a namespace pattern,
  as `read`, `write` or `admin`, with an expiry and a last-used time.
  Signed JWTs from the console's sign-in are accepted too, checked against
  its JWKS. Every request is checked against the caller's role, and every
  change goes into an audit log.
- ✅ Protected branches change only by merge. A mount can be read-only and
  pinned to one commit, so readers never claim a branch. `--fork NAME`
  forks before it mounts.
- ✅ Merge: three-way merge of trees against the common ancestor, with
  conflicts reported per file rather than resolved silently. Text files
  merge line by line. Merges into one branch take turns, in order, like a
  queue. A merge commit records both parents, so the next merge starts from
  it, and garbage collection keeps both histories.
- ✅ File API: read, list, search, ranged reads, and commits of many writes
  and deletes at once, for agents that never mount.
- ✅ Sessions: each SDK client or MCP connection registers a session that
  sends heartbeats and expires. Commits record their session. Next: mounts
  registering sessions themselves.
- ✅ Change feed: what each commit touched since a given one, derived from
  the log. Next: pushing it instead of polling.
- ✅ Claims for coordination between agents ("I'm working on `auth/`"),
  kept in the control plane, not the filesystem. They are advice, not
  locks, and they end with their session. They replace branch leases.
- ✅ Python and TypeScript SDKs over the spec, with a thin hand-written
  layer: `ns.branch("main").fork("agent-37")`. TypeScript types are
  generated from the spec. Bulk uploads straight to the bucket come later.
- ✅ An MCP server exposing fork, list, read, search, write, delete, diff,
  log and merge, so any MCP-capable agent can work in its own branch
  without custom code.
- Integration examples: Docker volumes, microVMs (Cloud Hypervisor and
  QEMU over virtio-fs; Firecracker through the API), and hosted sandboxes
  through the SDK or MCP. Written once, then removed; to be written again
  for the docs.

**Exit test:** a sample orchestrator fans out 100 agents on one codebase,
each in its own fork through the SDK or MCP, and merges the successful
branches back into `main` without a human touching a terminal. ✅
`e2e/swarm`: 100 agents (10 through MCP) in 2.4 s; 90 merged into a
protected `main`, 10 rejected by the orchestrator's check, and 14
conflicts retried on a fresh fork without help.

## Phase 6: The web console (3–4 weeks) ✅

See and steer what the agents are doing.

- Live like Linear: a sync engine (Zero) keeps a copy of the organization's
  branches, commits, sessions and activity in each browser, and changes
  appear everywhere the moment the API writes them.
- The fork tree: every branch, under the branch it came from.
- Live activity, and the sessions at work with the paths they hold.
- Every commit's diff, with an inline file viewer.
- Time travel: step through a branch's history, see the files as they
  were, and fork from any commit.
- Merging from the branch page: a fork of a protected branch is checked
  for conflicts, then merge lands it and reject deletes it. Cherry-picking
  comes later.
- People and organizations: sign-in with Better Auth in `apps/console`
  (passkeys, two-factor), one person in many organizations, members,
  invites and roles, and API keys for agents.
- Environments: an organization groups its namespaces (filesystems in the
  console) by environment, the first part of the name (`prod/app`). A
  sidebar holds an environment's views with live counts. Its home page is
  a table of its filesystems; "Now" shows agents at work, forks waiting
  to merge (with "Merge N clean") and what went wrong; Agents and Activity span the environment. A
  filesystem's page shows its open branches as a tree grouped by name, and
  its main branch's history. Agents are named on every commit.
- Usage: commits and merges per day, and per repo. Storage per
  namespace comes with metering in Phase 7.

**Exit test:** watch the Phase 5 swarm live in the browser, rewind one
agent to the moment it broke something, fork a retry from there, and merge
the winner, all from the console.

**Result:** the swarm's 100 agents and their 90 merges (7 seconds on a
laptop) appeared in the fork tree as they happened. Agent 42's merge had overwritten
agent 41's line of `config.toml`; rewinding `main` one commit showed the
file as agent 41 left it, a retry forked from there took a new commit, and
the retry merged cleanly, all in the browser.

## Phase 7: Production (3–4 weeks)

Everything a team needs to trust it with real work.

- One-command self-hosting: Docker Compose for a single machine, a Helm
  chart for clusters.
- Metrics, tracing and a health dashboard for every component.
- Fault testing: kill hosts, cut the network, slow the bucket, and check
  the guarantees from Phases 3 and 4 still hold.
- Regions: serve each namespace from the region it was created in.
- Bring your own bucket: a namespace can live in the customer's bucket.
- Organization isolation: content is never readable just by knowing its
  hash.
- On-disk format versioning and an upgrade path.
- Documentation, and the published benchmark report.

**Exit test:** a fresh machine goes from `git clone` to a running cluster,
console and 100-agent demo in under 15 minutes, and the published
benchmarks are reproducible by anyone.

## Timeline

Roughly six to eight months for one person working full time, less with
help. Phases 1 and 2 are the ones that prove the idea; the first public
benchmark post belongs at the end of Phase 2.
