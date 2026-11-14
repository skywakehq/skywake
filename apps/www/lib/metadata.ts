import type { Metadata } from "next";

import { imageSlug, pages, type PagePath } from "@/content/pages";
import { site } from "@/content/site";

// `image` is a slug under /og. `absolute` skips the "· Skywake" title suffix.
export function buildMetadata({
  path,
  title,
  description,
  image: slug,
  absolute = false,
}: {
  path: string;
  title: string;
  description: string;
  image: string;
  absolute?: boolean;
}): Metadata {
  const image = { url: `/og/${slug}`, width: 1200, height: 630, alt: title };
  return {
    title: absolute ? { absolute: title } : title,
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

export function pageMetadata(path: PagePath): Metadata {
  const { title, description } = pages[path];
  return buildMetadata({
    path,
    title,
    description,
    image: imageSlug(path),
    absolute: path === "/",
  });
}
