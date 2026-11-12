import { docsLLMs } from "@/lib/llms";
import { absoluteUrl } from "@/lib/zone";

export const dynamic = "force-static";

export function GET() {
  const text = `${docsLLMs.index()}

## For agents

- [All of the docs as one file](${absoluteUrl("/llms-full.txt")})
- [OpenAPI document](${absoluteUrl("/api/openapi/skywake")})
- Any page as Markdown: add \`.md\` to its URL, or ask for \`Accept: text/markdown\`
`;
  return new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
