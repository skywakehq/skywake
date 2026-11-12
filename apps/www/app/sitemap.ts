import type { MetadataRoute } from "next";

import { pagePaths, pages } from "@/content/pages";
import { site } from "@/content/site";
import { locales } from "@/lib/i18n";

export default function sitemap(): MetadataRoute.Sitemap {
  return locales.flatMap((locale) =>
    pagePaths.map((path) => ({
      url: new URL(path === "/" ? `/${locale}` : `/${locale}${path}`, site.url).toString(),
      changeFrequency: "weekly" as const,
      priority: pages[path].priority,
    })),
  );
}
