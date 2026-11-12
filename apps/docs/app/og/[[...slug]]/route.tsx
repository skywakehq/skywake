import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";

import { source } from "@/lib/source";

export const dynamic = "force-static";

export async function GET(_request: Request, { params }: RouteContext<"/og/[[...slug]]">) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: "#f6f5f1",
        color: "#1a1a18",
        borderTop: "12px solid #2f5bea",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 40 }}>
        <svg width={44} height={44} viewBox="0 0 24 24" fill="#1a1a18">
          <path d="M6.75 10.1a8 8 0 0 1 16 0Z" />
          <rect x="6.75" y="12.1" width="16" height="2.2" rx="1.1" />
          <rect x="3.75" y="15.9" width="13" height="2.2" rx="1.1" />
          <rect x="1.25" y="19.7" width="9" height="2.2" rx="1.1" />
        </svg>
        Skywake docs
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ fontSize: 68, letterSpacing: -2, lineHeight: 1.05, maxWidth: 1000 }}>
          {page.url === "/" ? "Skywake docs" : page.data.title}
        </div>
        {page.data.description && (
          <div style={{ fontSize: 30, lineHeight: 1.35, color: "#6b6a65", maxWidth: 980 }}>
            {page.data.description}
          </div>
        )}
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}

export function generateStaticParams() {
  return source.generateParams();
}
