import type { Metadata } from "next";

import { imageSlug, pages, type PagePath } from "@/content/pages";
import { site } from "@/content/site";

export function pageMetadata(path: PagePath): Metadata {
  const { title, description } = pages[path];
  const image = { url: `/og/${imageSlug(path)}`, width: 1200, height: 630, alt: title };
  return {
    title: path === "/" ? { absolute: title } : title,
    description,
    alternates: { canonical: path, types: { "text/plain": "/llms.txt" } },
    openGraph: {
      type: "website",
      siteName: site.name,
      locale: "en_US",
      url: path,
      title,
      description,
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
