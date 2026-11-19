import type { MetadataRoute } from "next";

import { pagePaths, pages } from "@/content/pages";
import { site } from "@/content/site";
import { locales, localizePath } from "@/lib/i18n";
import { languages } from "@/lib/metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  const all = pagePaths.map((path) => ({ path, priority: pages[path].priority }));
  const url = (path: string) => new URL(path, site.url).toString();
  // Every page in every language, each listing its translations.
  return locales.flatMap((locale) =>
    all.map(({ path, priority }) => ({
      url: url(localizePath(locale, path)),
      changeFrequency: "weekly" as const,
      priority,
      alternates: {
        languages: Object.fromEntries(
          Object.entries(languages(path)).map(([lang, href]) => [lang, url(href)]),
        ),
      },
    })),
  );
}
