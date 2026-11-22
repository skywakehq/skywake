import { FileJourney } from "@/components/art/file-journey";
import { SitePage } from "@/components/layout/site-page";
import { Compare } from "@/components/sections/compare";
import { Cost } from "@/components/sections/cost";
import { GetStarted } from "@/components/sections/get-started";
import { Bento } from "@/components/sections/bento";
import { Hero } from "@/components/sections/hero";
import { Numbers } from "@/components/sections/numbers";
import { OpenSource } from "@/components/sections/open-source";
import { SearchSection } from "@/components/sections/search";
import { Shared } from "@/components/sections/shared";
import { CtaRow } from "@/components/ui/cta-row";
import { UseCases } from "@/components/sections/use-cases";
import { getMessages } from "@/content/messages";
import { pageMetadata } from "@/lib/metadata";
import { JsonLd, structuredData } from "@/lib/structured-data";
import { pageLocale } from "@/lib/page";

export const instant = false;

export const generateMetadata = pageMetadata("/");

export default async function Home({ params }: PageProps<"/[locale]">) {
  const locale = await pageLocale(params);
  const t = getMessages(locale);
  return (
    <SitePage locale={locale} messages={t}>
      <JsonLd data={structuredData} />
      <FileJourney>
        <Hero t={t} />
        <Shared t={t} />
      </FileJourney>
      <CtaRow t={t} className="mt-12" />
      {/* Promise, then the aha, then what you'd use it for, proof, depth, objections, and the ask. */}
      <UseCases t={t} locale={locale} />
      <Numbers t={t} />
      <CtaRow t={t} className="mt-14" />
      <SearchSection t={t} />
      <Bento t={t} />
      <CtaRow t={t} className="mt-12" />
      <Compare t={t} />
      <Cost t={t} />
      <CtaRow t={t} className="mt-12" />
      <OpenSource t={t} />
      <GetStarted t={t} />
    </SitePage>
  );
}
