import { SitePage } from "@/components/layout/site-page";
import { Architecture } from "@/components/sections/architecture";
import { Benchmarks } from "@/components/sections/benchmarks";
import { Compare } from "@/components/sections/compare";
import { Features } from "@/components/sections/features";
import { GetStarted } from "@/components/sections/get-started";
import { Hero } from "@/components/sections/hero";
import { OpenSource } from "@/components/sections/open-source";
import { Band } from "@/components/ui/frame";
import { TextureBand } from "@/components/ui/texture";
import { getMessages } from "@/content/messages";
import { pageMetadata } from "@/lib/metadata";
import { structuredData } from "@/lib/structured-data";
import { pageLocale } from "@/lib/page";

export const instant = false;

export const generateMetadata = pageMetadata("/");

export default async function Home({ params }: PageProps<"/[locale]">) {
  const locale = await pageLocale(params);
  const t = getMessages(locale);
  return (
    <SitePage locale={locale} messages={t}>
      <script
        type="application/ld+json"
        // Escaped so the JSON can't close the script tag early.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <Hero t={t} />
      <Features t={t} />
      <TextureBand />
      <Architecture t={t} />
      <Benchmarks t={t} />
      <TextureBand />
      <Compare t={t} />
      <OpenSource t={t} />
      {/* Blank space before the waitlist, which has its own pattern. */}
      <Band className="h-28 sm:h-36" />
      <GetStarted t={t} />
    </SitePage>
  );
}
