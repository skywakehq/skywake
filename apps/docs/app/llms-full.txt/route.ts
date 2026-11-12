import { docsLLMs } from "@/lib/llms";

export const dynamic = "force-static";

export async function GET() {
  return new Response(await docsLLMs.full(), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
