import type { MetadataRoute } from "next";

import { site } from "@/content/site";

const docs = new URL(site.docsUrl, site.url).toString().replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/dashboard" },
    sitemap: [new URL("/sitemap.xml", site.url).toString(), `${docs}/sitemap.xml`],
    host: site.url,
  };
}
