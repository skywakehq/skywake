import { pages } from "@/content/pages";
import { site } from "@/content/site";
import { localizePath, type Locale } from "@/lib/i18n";

const url = (path: string) => new URL(path, site.url).toString();
const docs = (path = "") => `${url(site.docsUrl).replace(/\/$/, "")}${path}`;

const organization = { "@id": url("/#organization") };

/** Who makes Skywake and what it is, for the home page. */
export const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      ...organization,
      name: site.name,
      url: url("/"),
      logo: url("/apple-icon"),
      email: site.email,
      sameAs: [
        site.repoUrl,
        "https://www.npmjs.com/package/skywake",
        "https://pypi.org/project/skywake/",
      ],
    },
    {
      "@type": "WebSite",
      "@id": url("/#website"),
      name: site.name,
      url: url("/"),
      publisher: organization,
    },
    {
      "@type": "SoftwareApplication",
      "@id": url("/#software"),
      name: site.name,
      url: url("/"),
      description: pages["/"].description,
      applicationCategory: "DeveloperApplication",
      applicationSubCategory: "Filesystem for AI agents",
      operatingSystem: "Linux, macOS",
      license: "https://www.apache.org/licenses/LICENSE-2.0",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "Versioned filesystem on S3 or any object storage",
        "Fork a workspace for each agent in 10 ms, whatever its size",
        "Diff and merge an agent's changes like git",
        "Mount a branch as a local folder on Linux",
        "MCP server, bash tool, CLI, HTTP API and SDKs",
        "Vector, full-text and hybrid search indexes",
      ],
      softwareHelp: { "@type": "CreativeWork", url: docs() },
      downloadUrl: "https://www.npmjs.com/package/skywake",
      sameAs: [site.repoUrl],
      publisher: organization,
    },
    {
      "@type": "SoftwareSourceCode",
      name: site.name,
      codeRepository: site.repoUrl,
      license: "https://www.apache.org/licenses/LICENSE-2.0",
      programmingLanguage: ["Rust", "TypeScript"],
      targetProduct: { "@id": url("/#software") },
    },
  ],
};

/** Where a page sits under the home page, for the breadcrumb in search results. */
export function breadcrumbs(locale: Locale, trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: site.name, path: "/" }, ...trail].map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: url(localizePath(locale, item.path)),
    })),
  };
}

/** A use case guide: a how-to article by Skywake. */
export function guideArticle(
  locale: Locale,
  { path, title, description }: { path: string; title: string; description: string },
) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    description,
    url: url(localizePath(locale, path)),
    inLanguage: locale,
    image: url(`${localizePath(locale, path)}/opengraph-image`),
    author: organization,
    publisher: organization,
    about: { "@id": url("/#software") },
  };
}

/** JSON-LD in a script tag, escaped so the JSON can't close the tag early. */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
