# Changelog

All notable changes to Skywake. Releases follow [Semantic Versioning](https://semver.org);
release-please writes each release's section from the commit messages.

## Unreleased

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
