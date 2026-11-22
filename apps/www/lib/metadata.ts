import type { Metadata } from "next";

import { getMessages } from "@/content/messages";
import type { PagePath } from "@/content/pages";
import { site } from "@/content/site";
import { defaultLocale, isLocale, localeOg, locales, localizePath, type Locale } from "@/lib/i18n";

type Props = { params: Promise<{ locale: string }> };

/** The same page in every language, so search engines show each reader their own. */
export function languages(path: string) {
  return {
    ...Object.fromEntries(locales.map((l) => [l, localizePath(l, path)])),
    "x-default": localizePath(defaultLocale, path),
  };
}

// `path` has no locale. `absolute` skips the "· Skywake" title suffix. The share image
// comes from the page's own opengraph-image and twitter-image files.
export function buildMetadata({
  locale,
  path,
  title,
  description,
  absolute = false,
}: {
  locale: Locale;
  path: string;
  title: string;
  description: string;
  absolute?: boolean;
}): Metadata {
  const url = localizePath(locale, path);
  return {
    title: absolute ? { absolute: title } : title,
    description,
    alternates: {
      canonical: url,
      languages: languages(path),
      types: { "text/markdown": "/llms.txt" },
    },
    openGraph: {
      type: "website",
      siteName: site.name,
      locale: localeOg[locale],
      alternateLocale: locales.filter((l) => l !== locale).map((l) => localeOg[l]),
      url,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

const localeOf = async (params: Props["params"]) => {
  const { locale } = await params;
  return isLocale(locale) ? locale : defaultLocale;
};

/** generateMetadata for a page, in the reader's language. */
export function pageMetadata(path: PagePath) {
  return async ({ params }: Props): Promise<Metadata> => {
    const locale = await localeOf(params);
    const { title, description } = getMessages(locale).pages[path];
    return buildMetadata({
      locale,
      path,
      title,
      description,
      absolute: path === "/",
    });
  };
}
