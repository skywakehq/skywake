import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";

import { source, type Page } from "./source";
import { absoluteUrl } from "./zone";

const site = absoluteUrl("/").replace(/\/docs$/, "");

/** A docs page for search engines: a TechArticle by Skywake, and where it sits in the docs. */
export function pageStructuredData(page: Page) {
  const url = absoluteUrl(page.url);
  const crumbs = getBreadcrumbItems(page.url, source.getPageTree()).filter(
    (item) => typeof item.name === "string",
  );
  const trail = [
    { name: "Skywake", url: `${site}/` },
    { name: "Docs", url: absoluteUrl("/") },
    ...crumbs.map((item) => ({
      name: item.name as string,
      url: item.url && absoluteUrl(item.url),
    })),
  ];
  if (page.url !== "/") trail.push({ name: page.data.title ?? "", url });
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        "@id": `${url}#article`,
        headline: page.data.title,
        description: page.data.description,
        url,
        inLanguage: "en",
        image: absoluteUrl(page.url === "/" ? "/og" : `/og${page.url}`),
        isPartOf: { "@type": "WebSite", name: "Skywake docs", url: absoluteUrl("/") },
        about: { "@type": "SoftwareApplication", name: "Skywake", url: `${site}/` },
        author: { "@type": "Organization", name: "Skywake", url: `${site}/` },
        publisher: { "@id": `${site}/#organization` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: trail
          // The same section twice in a row reads as noise.
          .filter((item, i) => i === 0 || item.name !== trail[i - 1]!.name)
          .map((item, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: item.name,
            ...(item.url ? { item: item.url } : {}),
          })),
      },
    ],
  };
}

/** JSON for a `<script>`, escaped so it can't close the tag early. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
