import { FileJourney } from "@/components/art/file-journey";
import { SitePage } from "@/components/layout/site-page";
import { Cost } from "@/components/sections/cost";
import { GetStarted } from "@/components/sections/get-started";
import { Bento } from "@/components/sections/bento";
import { Hero } from "@/components/sections/hero";
import { Numbers } from "@/components/sections/numbers";
import { OpenSource } from "@/components/sections/open-source";
import { SearchSection } from "@/components/sections/search";
import { Shared } from "@/components/sections/shared";
import { UseCases } from "@/components/sections/use-cases";
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
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <FileJourney>
        <Hero t={t} />
        <Shared t={t} />
      </FileJourney>
      <SearchSection t={t} />
      <UseCases t={t} locale={locale} />
      <Bento t={t} />
      <Numbers t={t} />
      <Cost t={t} />
      <OpenSource t={t} />
      <GetStarted t={t} />
    </SitePage>
  );
}
