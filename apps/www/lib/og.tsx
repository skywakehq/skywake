import { ogCard, ogContentType, ogFonts, ogSize } from "@skywake/ui/og";
import { ImageResponse } from "next/og";

import { getMessages } from "@/content/messages";
import { site } from "@/content/site";
import { defaultLocale, isLocale, localizePath, type Locale } from "@/lib/i18n";

// Every page's share image is the same card; only the words change.
export const size = ogSize;
export const contentType = ogContentType;
export const alt = "Skywake";

type Params = Promise<{ locale: string; slug?: string }>;
type Page = "/" | "/pricing" | "/use-cases" | "/privacy" | "/terms" | "/use-cases/[slug]";

const host = new URL(site.url).host;

function card(locale: Locale, page: Page, slug = "") {
  const t = getMessages(locale);
  const path = page.replace("[slug]", slug);
  const base = {
    path: `${host}${localizePath(locale, path)}`,
    file: `${path.split("/").pop()}.md`,
  };
  switch (page) {
    case "/":
      return {
        ...base,
        title: t.hero.titleBefore,
        accent: t.hero.titleAccent,
        loop: true,
        file: "launch-deck.pdf",
      };
    case "/pricing":
      return { ...base, title: t.plans.title, section: t.plans.eyebrow };
    case "/use-cases":
      return { ...base, title: t.guides.title, section: t.guides.eyebrow };
    case "/use-cases/[slug]":
      return {
        ...base,
        title: t.guides.items[slug]?.title ?? t.guides.title,
        section: t.guides.eyebrow,
      };
    case "/privacy":
      return { ...base, title: t.legal.privacy.title };
    case "/terms":
      return { ...base, title: t.legal.terms.title };
  }
}

/** The default export of an `opengraph-image` or `twitter-image` file for one page. */
export function ogImage(page: Page) {
  return async function Image({ params }: { params: Params }) {
    const { locale, slug } = await params;
    const lang = isLocale(locale) ? locale : defaultLocale;
    return new ImageResponse(ogCard(card(lang, page, slug)), { ...ogSize, fonts: await ogFonts() });
  };
}
