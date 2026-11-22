import { files, search, type StatGroup } from "@/content/numbers";
import { pagePaths, pages } from "@/content/pages";
import { site } from "@/content/site";
import { en } from "@/content/messages/en";
import { useCases } from "@/content/use-cases";

const url = (path: string) => new URL(path, site.url).toString();
const docs = new URL(site.docsUrl, site.url).toString().replace(/\/$/, "");

const facts = (groups: StatGroup[]) =>
  groups
    .flatMap((group) => group.stats.map((stat) => `- ${stat.figure}: ${stat.label}`))
    .join("\n");

const text = `# ${site.name}

> ${pages["/"].description}

${site.name} is open source (Apache-2.0) and runs on any object storage with conditional writes, such as AWS S3, Cloudflare R2 or RustFS. It has two products on the same bucket:

- **Filesystem**: a shared, versioned disk. Mount it as a normal local folder on any machine, so many agents read and write the same files, then branch, diff and merge the changes like git. Saved writes survive a crash.
- **Search**: vector, full-text (BM25) and hybrid search indexes, read straight from object storage, with branches and time travel like the filesystem.

Self-hosting is free today. A hosted version, Skywake Cloud, is coming soon: join the waitlist at ${url("/#waitlist")}.

Agents use it through an MCP server (\`npx -y skywake mcp\`), a bash tool, the \`skywake\` CLI, an HTTP API, or SDKs in TypeScript, Python, Go, Rust, Ruby, Java and C#.

## Connect an agent

Add the MCP server to the agent's MCP config. It gives the agent file tools, a bash shell and search on a disk, and works on a branch of its own unless you set \`SKYWAKE_BRANCH\`.

\`\`\`json
{
  "mcpServers": {
    "skywake": {
      "command": "npx",
      "args": ["-y", "skywake", "mcp"],
      "env": { "SKYWAKE_API_KEY": "sw_...", "SKYWAKE_DISK": "app" }
    }
  }
}
\`\`\`

- MCP registry name: \`dev.skywake/skywake\`
- Registry entry: ${url("/.well-known/mcp/server.json")}
- npm: https://www.npmjs.com/package/skywake

## Docs

- [What is an agent filesystem?](${docs}/agent-filesystem): why agents need a shared disk with branches, and how Skywake does it
- [Docs index](${docs}/llms.txt): every docs page, with a one-line summary
- [Full docs](${docs}/llms-full.txt): all of the docs as one Markdown file
- [OpenAPI document](${docs}/api/openapi/skywake): the HTTP API
- [MCP server](${docs}/agents/mcp): connect an agent
- [Quickstart](${docs}/getting-started)
- Any docs page as Markdown: add \`.md\` to its URL

## Pages

${pagePaths.map((path) => `- [${pages[path].title}](${url(path)}): ${pages[path].description}`).join("\n")}

## Use case guides

${useCases.map(({ id }) => `- [${en.guides.items[id]!.title}](${url(`/use-cases/${id}`)}): ${en.guides.items[id]!.lead}`).join("\n")}

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
