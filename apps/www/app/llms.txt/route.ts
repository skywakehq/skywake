import { files, search, type StatGroup } from "@/content/numbers";
import { pagePaths, pages } from "@/content/pages";
import { site } from "@/content/site";

const url = (path: string) => new URL(path, site.url).toString();
const docs = new URL(site.docsUrl, site.url).toString().replace(/\/$/, "");

const facts = (groups: StatGroup[]) =>
  groups
    .flatMap((group) => group.stats.map((stat) => `- ${stat.figure}: ${stat.label}`))
    .join("\n");

const text = `# ${site.name}

> ${pages["/"].description}

${site.name} is open source (Apache-2.0) and runs on any object storage with conditional writes, such as AWS S3, Cloudflare R2 or RustFS. It has two products on the same bucket:

- **Filesystem**: a versioned filesystem. Mount any branch as a normal local folder, give each agent its own copy of a workspace in milliseconds whatever its size, then diff and merge the changes like git. Saved writes survive a crash.
- **Search**: vector, full-text (BM25) and hybrid search indexes, read straight from object storage, with branches and time travel like the filesystem.

Agents use it through an MCP server (\`uvx skywake-mcp\`), the \`skywake\` CLI, an HTTP API, or SDKs in TypeScript, Python, Go, Rust, Ruby, Java and C#.

## Docs

- [Docs index](${docs}/llms.txt): every docs page, with a one-line summary
- [Full docs](${docs}/llms-full.txt): all of the docs as one Markdown file
- [OpenAPI document](${docs}/api/openapi/skywake): the HTTP API
- [MCP server](${docs}/agents/mcp): connect an agent
- [Quickstart](${docs}/getting-started)
- Any docs page as Markdown: add \`.md\` to its URL

## Pages

${pagePaths.map((path) => `- [${pages[path].title}](${url(path)}): ${pages[path].description}`).join("\n")}

## Benchmarks

Filesystem (${files.setup}):
${facts(files.groups)}

Search (${search.setup}):
${facts(search.groups)}

## Optional

- [Source code](${site.repoUrl})
- [Benchmarks in the docs](${docs}/benchmarks)
`;

export function GET() {
  return new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
