import { notFound } from "next/navigation";

import { docsLLMs } from "@/lib/llms";
import { source } from "@/lib/source";

export const dynamic = "force-static";

export async function GET(_request: Request, { params }: RouteContext<"/llms.mdx/[[...slug]]">) {
  const { slug = [] } = await params;
  // `/index.md` is the home page.
  const page = source.getPage(slug.join("/") === "index" ? [] : slug);
  if (!page) notFound();
  return new Response(await docsLLMs.page(page), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}

export function generateStaticParams() {
  return source.generateParams();
}
