import type { MetadataRoute } from "next";

import { source } from "@/lib/source";
import { absoluteUrl } from "@/lib/zone";

export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({
    url: absoluteUrl(page.url),
    changeFrequency: "weekly",
    priority: page.url === "/" ? 0.9 : 0.6,
  }));
}
