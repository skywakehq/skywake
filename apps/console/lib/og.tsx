import { ogCard, ogFonts, ogSize } from "@skywake/ui/og";
import { ImageResponse } from "next/og";

import { withBase } from "@/lib/zone";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "Skywake";

const host = new URL(process.env.BETTER_AUTH_URL ?? "https://skywake.dev").host;

/** The site's share card for a console page. */
export function ogImage(title: string, path: string) {
  return async function Image() {
    const card = { title, path: `${host}${withBase(path)}`, file: "launch-deck.pdf" };
    return new ImageResponse(ogCard(card), { ...ogSize, fonts: await ogFonts() });
  };
}
