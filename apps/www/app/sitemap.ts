import type { MetadataRoute } from "next";

import { pagePaths, pages } from "@/content/pages";
import { site } from "@/content/site";
import { useCases } from "@/content/use-cases";
import { locales } from "@/lib/i18n";

export default function sitemap(): MetadataRoute.Sitemap {
  const all = [
    ...pagePaths.map((path) => ({ path, priority: pages[path].priority })),
    ...useCases.map((item) => ({ path: `/use-cases/${item.id}`, priority: 0.6 })),
  ];
  return locales.flatMap((locale) =>
    all.map(({ path, priority }) => ({
      url: new URL(path === "/" ? `/${locale}` : `/${locale}${path}`, site.url).toString(),
      changeFrequency: "weekly" as const,
      priority,
    })),
  );
}
