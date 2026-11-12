# Skywake docs

The documentation site. Fumadocs on Next.js. It stands alone: no other app
needs to run. It can also sit behind another app at a path, as a Next.js
zone.

```sh
pnpm dev:docs                                  # http://localhost:3200/docs
pnpm dev:all                                   # the site, docs and console on http://localhost:3000
```

## Settings

Both are read at build time.

| Variable            | Default              | Meaning                                                    |
| ------------------- | -------------------- | ---------------------------------------------------------- |
| `DOCS_BASE_PATH`    | `/docs`              | The path the docs live under. Empty for a host's root.     |
| `DOCS_ASSET_PREFIX` | `<base path>-static` | Where its `/_next` files live, apart from any other app's. |

## Behind another app

- `apps/www` forwards `/docs`, `/docs/*`, `/docs-static/*` and Next's `.rsc`
  and segment paths to `DOCS_URL`, only when it is set (`apps/www/lib/rewrites.ts`).
  Without it, the site links to `DOCS_LINK`, by default the public docs.
- In your own cloud, a proxy in front routes the paths instead: the Helm
  chart's Ingress, or Compose's `docs` profile behind your proxy. See
  `content/docs/self-hosting/what-to-run.mdx`.
- Links from other apps to the docs are plain `<a>`: crossing apps is a full
  page load.

## Routes

All paths are under the base path.

| Path                         | From                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `/`                          | `content/docs/index.mdx`                              |
| `/getting-started/*`         | `content/docs/getting-started/`                       |
| `/filesystem/*`              | `content/docs/filesystem/`                            |
| `/indexes/*`                 | `content/docs/indexes/`                               |
| `/agents/*`                  | `content/docs/agents/`                                |
| `/self-hosting/*`            | `content/docs/self-hosting/`                          |
| `/security/*`                | `content/docs/security/`                              |
| `/benchmarks`                | `content/docs/benchmarks.mdx`                         |
| `/reference/api/<tag>/<op>`  | `packages/contract/generated/openapi.json`, generated |
| `/reference/cli/<command>`   | `generated/cli.json`, from clap in `crates/cli`       |
| `/reference/sdk/<operation>` | `content/sdk/examples.ts`                             |
| `/api/search`                | Fumadocs search over every page                       |

## Files

```
apps/docs/
  app/
    layout.tsx                  fonts, theme, search
    global.css                  Fumadocs on Skywake's tokens: flat, hard corners
    (docs)/
      layout.tsx                the shell around every page
      [[...slug]]/page.tsx      one route; picks the renderer by the page's source
    api/search/route.ts         search over every page
    api/openapi/[id]/route.ts   the OpenAPI document, fetched once per visit
  components/
    shell/                      the sidebar, top bar, page frame and TOC, in @skywake/ui's AppShell
    mdx.tsx                     MDX components
    cards.tsx                   <Card href>: title, icon and text from the page it links to
    home.tsx                    the home page's hero and sections
    api-page.tsx                OpenAPI page renderer
    api-overview.tsx            the API's base path and version, from the document
    cli/command-page.tsx        one CLI command, laid out like its --help
    sdk/operation-page.tsx      one SDK operation, as language tabs
    inline-code.tsx             backticks in help text
  lib/
    zone.ts                     the basePath, shared with next.config.ts
    source.ts                   one loader over four sources
    openapi.ts                  the OpenAPI source, and page titles from operation ids
    cli/                        CLI pages from generated/cli.json
    sdk/source.ts               SDK pages from content/sdk/examples.ts
  content/
    docs/**                     guides, MDX
    sdk/examples.ts             one example per operation per language
  generated/
    cli.json                    `skywake __docs-spec`; a Rust test keeps it current
  scripts/
    check-sdk-examples.ts       every example calls only what its SDK has (lint)
    check-links.ts              every internal link resolves (build)
```

Every guide and folder names a [Lucide](https://lucide.dev/icons) icon in
its frontmatter or `meta.json` (`icon: GitFork`); the sidebar, page headers
and cards draw it. Guides end with `## Next` and a few `<Card href="..." />`.

Guides link to each other by file (`../indexes/filters.mdx`) and to the
references by route (`/reference/cli/mount`), never with `/docs`.

## Reference

Never hand-written.

- **HTTP API.** `build` first rewrites `openapi.json` from the contract
  (`packages/contract/emit.ts`), so the pages can't drift.
- **CLI.** `skywake __docs-spec > apps/docs/generated/cli.json`. The CLI's
  tests fail when the file differs from clap's command tree; run
  `UPDATE_DOCS_SPEC=1 cargo test -p skywake-cli docs_spec` to rewrite it.
- **SDKs.** `content/sdk/examples.ts`. `lint` fails when an example calls a
  method its SDK doesn't define. The examples are not run yet.
