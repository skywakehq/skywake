import type { MetadataRoute } from "next";

import { pagePaths, pages } from "@/content/pages";
import { site } from "@/content/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return pagePaths.map((path) => ({
    url: new URL(path, site.url).toString(),
    changeFrequency: "weekly",
    priority: pages[path].priority,
  }));
}
