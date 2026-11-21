# Changelog

All notable changes to Skywake. Releases follow [Semantic Versioning](https://semver.org);
release-please writes each release's section from the commit messages.

## 0.3.0 (2026-11-22)

### Disks

- Skywake is disks only: standalone indexes and agent sessions are gone.
  Search is turned on per disk, and deleting a disk deletes its search data.
- The console is rebuilt around disks: commits and changes per disk, a delete
  button, and settings split into general, members, keys, account and billing.
- The Mac app is back, with browser sign-in and mounted disks.
- The site is redesigned around one shared disk.

### Plans

- Plans are flat by storage: Free (10 GB), Launch ($20 a month, 500 GB) and
  Scale ($50 a month, 3 TB). Nothing is metered; writes fail with `402` at the
  plan's storage.
- SSO, the audit log, IP allowlists and customer-managed keys are on
  Enterprise only for now.
- `MAX_USERS` on the console stops new accounts at that many people, unless
  they hold an invitation.

### Engine

- Faster vector queries at 10M rows, appends to delta pieces, and branch
  merges by line.

## 0.2.0 (2026-11-17)

### v2

- `/v2` API: disks and indexes by short name, the environment taken from the
  key, and one error shape, `{error: {code, message, hint, request_id}}`.
- Every SDK (TypeScript, Python, Go, Rust, Java, C#, Ruby) moves to disk and
  index handles with typed errors.
- One CLI verb set with `NAME@BRANCH` and `--local`, plus `skywake mcp` and
  `skywake types`. `skywake login` signs in through the browser.
- The console addresses things by environment and short name, and Search is a
  tab on a disk.
- Every docs example and landing guide is a file that CI runs against a real
  server.

### Breaking

- API keys start with `sw_` and end with a checksum, so secret scanners can
  find leaked keys. Keys made before (`bfs_...`) no longer work; make new ones.
- Merging into a protected branch needs the `admin` role.
- Listing and revoking keys, and reading the audit log, need an admin key for
  every namespace (`*`).
- Key scopes use `*` only as a whole part of a name: `prod/*` or `*`, never
  `prod*`. `expires_in_days` is a whole number from 1 to 3650.
- `SKYWAKE_API_JWKS_URL` needs `SKYWAKE_API_JWT_ISSUER` and `SKYWAKE_API_JWT_AUDIENCE`.
- `SKYWAKE_API_TRUST_PROXY` is the number of proxies in front of the API
  (`true` still means one), and the client address is read from the right of
  `X-Forwarded-For`.
- Files store their permission bits (`mode`) instead of an executable flag.
  Stores written before cannot be read.

### Added

- `POST /v1/namespaces/{namespace}/credentials`: short-lived S3 credentials
  that reach only one namespace's folder, minted with STS AssumeRole
  (`SKYWAKE_API_STS_ROLE_ARN`). Both SDKs can ask for them.
- Every error answer carries a `code` and the `request_id`.
- Structured JSON request logs, Prometheus metrics on `SKYWAKE_API_METRICS_LISTEN`,
  and `/ready`, which checks Postgres and the stores.
- The SDKs retry with jittered backoff and time out, and their errors carry
  `code` and the request id.
- `npx skywake` on Linux (x86_64 and arm64), and signed release binaries.
- Docker: each service connects to Postgres as its own role.

### Fixed

- The rate limit counts each key and user too, cannot be dodged with a forged
  `X-Forwarded-For`, never limits health checks, and clears old counts.
- Large file reads stream from the store a piece at a time.
- A key of one organization could drop another organization's claims by
  ending a session id it did not own.
- Merges no longer hold a database connection while they work on S3.
- The API keeps a bounded number of namespace engines open.
