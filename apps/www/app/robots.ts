import type { MetadataRoute } from "next";

import { site } from "@/content/site";

const docs = new URL(site.docsUrl, site.url).toString().replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    // The console stays out, except the pages people share a link to.
    rules: {
      userAgent: "*",
      allow: ["/", "/dashboard/sign-up", "/dashboard/sign-in"],
      disallow: "/dashboard",
    },
    sitemap: [new URL("/sitemap.xml", site.url).toString(), `${docs}/sitemap.xml`],
    host: site.url,
  };
}
