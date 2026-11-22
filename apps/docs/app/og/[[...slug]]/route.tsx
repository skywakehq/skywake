import { ogCard, ogFonts, ogSize } from "@skywake/ui/og";
import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

import { source } from "@/lib/source";
import { absoluteUrl } from "@/lib/zone";

// A route, not an opengraph-image file: Next allows no file after the
// optional catch-all the docs pages live under.
export const dynamic = "force-static";

export function generateStaticParams() {
  return source.generateParams();
}

/** The site's share card, with the docs section in the pill and the page as the file. */
export async function GET(_request: Request, { params }: RouteContext<"/og/[[...slug]]">) {
  const { slug = [] } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const section = getBreadcrumbItems(page.url, source.getPageTree())[0]?.name;
  const card = {
    title: slug.length ? (page.data.title ?? "") : "Skywake docs",
    section:
      typeof section === "string" && section !== page.data.title ? `Docs · ${section}` : "Docs",
    path: absoluteUrl(page.url).replace(/^https?:\/\//, ""),
    file: `${slug.at(-1) ?? "README"}.md`,
  };
  return new ImageResponse(ogCard(card), { ...ogSize, fonts: await ogFonts() });
}
