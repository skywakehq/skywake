import { search } from "@/content/numbers";
import { pagePaths, pages } from "@/content/pages";
import { site } from "@/content/site";

const url = (path: string) => new URL(path, site.url).toString();
const docs = new URL(site.docsUrl, site.url).toString().replace(/\/$/, "");

const facts = search.groups
  .flatMap((group) => group.stats.map((stat) => `- ${stat.figure}: ${stat.label}`))
  .join("\n");

const text = `# ${site.name}

> ${pages["/"].description}

${site.name} is an open-source (Apache-2.0) search index that keeps its data in object storage you own: AWS S3, Cloudflare R2, Google Cloud Storage, Azure Blob or any store with conditional writes. It is an alternative to turbopuffer that you can run yourself.

- **Search**: vector, full-text (BM25) and hybrid search in one query, with filters, counts and groups. Text is embedded for you, or bring your own vectors.
- **Branches**: fork an index without copying it, write to the fork, and merge it back. Every change is kept as a version you can go back to.
- **Storage**: rows live in your bucket at object storage prices. A cache on NVMe next to the servers keeps warm queries fast.

Self-hosting is free today. A hosted version, Skywake Cloud, is coming soon: join the waitlist at ${url("/#waitlist")}.

Use it through the \`skywake\` CLI, an HTTP API, an MCP server (\`npx skywake mcp\`), or SDKs in TypeScript, Python, Go, Rust, Ruby, Java and C#.

## Docs

- [Docs index](${docs}/llms.txt): every docs page, with a one-line summary
- [Full docs](${docs}/llms-full.txt): all of the docs as one Markdown file
- [OpenAPI document](${docs}/api/openapi/skywake): the HTTP API
- [MCP server](${docs}/mcp): connect an agent
- [Quickstart](${docs}/getting-started)
- Any docs page as Markdown: add \`.md\` to its URL

## Pages

${pagePaths.map((path) => `- [${pages[path].title}](${url(path)}): ${pages[path].description}`).join("\n")}

## Benchmarks

${search.setup}:
${facts}

## Optional

- [Source code](${site.repoUrl})
- [Benchmarks in the docs](${docs}/benchmarks)
`;

export function GET() {
  return new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
