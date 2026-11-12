# Contributing to Skywake

Thanks for helping. This guide covers getting the code running, the checks
every change has to pass, and how to send it.

## The layout

```
crates/      the Rust workspace: storage engine, mount, daemon, CLI
apps/        the API, the web console and the website
packages/    code the apps share: the API contract, the design system, TypeScript and ESLint settings
sdks/        the TypeScript and Python SDKs
e2e/         tests of the whole system
docker/      self-hosting with Docker Compose; dev/ has local S3 and Postgres, and a Linux container with FUSE
scripts/     the console stack, the formatter, the Linux shell
benchmarks/  system benchmarks (microbenchmarks live in each crate's benches/)
```

## Rust

The storage engine and the CLI build anywhere with a recent stable Rust:

```bash
cargo build
cargo test
cargo clippy --all-targets -- -D warnings
```

The mount and `skywaked` need FUSE, which means Linux. On macOS or Windows,
`scripts/shell.sh` builds a Linux container with FUSE, mounts the repository at
`/skywake` and runs whatever you pass it:

```bash
docker compose -f docker/dev/compose.yaml up -d   # the local S3 the container talks to
scripts/shell.sh cargo test                       # every test, including the mount's
scripts/shell.sh                                  # or an interactive shell
```

The benchmarks run through `scripts/bench.sh`; see [benchmarks/README.md](../benchmarks/README.md).

## Formatting

One script formats everything: Rust with rustfmt, Python with ruff, and
Markdown, JSON, YAML and the website with Prettier.

```bash
scripts/format.sh            # format
scripts/format.sh --check    # change nothing, fail if anything isn't formatted
```

CI runs the check, so run the script before you push.

## TypeScript

The apps, packages and SDK use [pnpm](https://pnpm.io) workspaces, and
[Turborepo](https://turborepo.com) runs each task across all of them.
With Node 22.18 or newer:

```bash
corepack enable
pnpm install
pnpm build               # also builds the engine for Node, so it needs Rust
pnpm typecheck
pnpm lint
pnpm test                # needs Postgres and S3 from docker/dev/compose.yaml
pnpm dev                 # the console, the API and zero-cache, on http://localhost:3100
pnpm dev:www             # the website, on http://localhost:3000
```

The console and the site share one design system, `packages/ui`: shadcn
components restyled to the site's look, and one theme. Add a component
with `pnpm dlx shadcn@latest add <name>` inside `packages/ui`, and import it
as `@skywake/ui/components/<name>`.

Every benchmark number on the site comes from `apps/www/content/numbers.ts`.
When a new run is published in `docs/benchmarks.md`, update that file, not the pages.

## Sending a change

1. Open an issue first for anything bigger than a small fix, so we can agree
   on the approach before you spend time on it.
2. Keep each pull request to one change. Add tests for behaviour you change,
   and a benchmark when the change is about speed.
3. Write commit messages in plain language: what changed and why, in the
   imperative ("Save small files inside their folder's tree").
4. Make sure `cargo test`, `cargo clippy` and `scripts/format.sh --check` pass.

Changes that touch durability (saves, crash recovery, branch takeover) need
a test that shows the guarantee still holds.

## Conduct and license

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
Contributions are licensed under [Apache-2.0](LICENSE), the same as the
project.
