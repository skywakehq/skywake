import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";

import { imageSlug, pagePaths, pages } from "@/content/pages";
import { site } from "@/content/site";
import { INK, LogoMark, MUTED, PAPER, SIGNAL } from "@/lib/brand-image";

export function generateStaticParams() {
  return pagePaths.map((path) => ({ slug: imageSlug(path) }));
}

export async function GET(_request: Request, { params }: RouteContext<"/og/[slug]">) {
  const { slug } = await params;
  const path = pagePaths.find((candidate) => imageSlug(candidate) === slug);
  if (!path) notFound();
  const { title, description } = pages[path];
  const headline = path === "/" ? "Fast files and search for your agents and apps." : title;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: PAPER,
        color: INK,
        borderTop: `12px solid ${SIGNAL}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 40 }}>
        <LogoMark size={44} />
        {site.name}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ fontSize: 68, letterSpacing: -2, lineHeight: 1.05, maxWidth: 1000 }}>
          {headline}
        </div>
        <div style={{ fontSize: 30, lineHeight: 1.35, color: MUTED, maxWidth: 980 }}>
          {description}
        </div>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
