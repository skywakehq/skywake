import { pages } from "@/content/pages";
import { site } from "@/content/site";

const url = (path: string) => new URL(path, site.url).toString();

export const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": url("/#organization"),
      name: site.name,
      url: url("/"),
      logo: url("/apple-icon"),
      sameAs: [site.repoUrl],
    },
    {
      "@type": "WebSite",
      "@id": url("/#website"),
      name: site.name,
      url: url("/"),
      publisher: { "@id": url("/#organization") },
    },
    {
      "@type": "SoftwareApplication",
      name: site.name,
      url: url("/"),
      description: pages["/"].description,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Linux, macOS",
      license: "https://www.gnu.org/licenses/gpl-3.0.html",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@id": url("/#organization") },
    },
    {
      "@type": "SoftwareSourceCode",
      name: site.name,
      codeRepository: site.repoUrl,
      license: "https://www.gnu.org/licenses/gpl-3.0.html",
      programmingLanguage: ["Rust", "TypeScript"],
    },
  ],
};
