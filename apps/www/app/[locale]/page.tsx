import { notFound } from "next/navigation";

import { SitePage } from "@/components/layout/site-page";
import { Architecture } from "@/components/sections/architecture";
import { Benchmarks } from "@/components/sections/benchmarks";
import { Cost } from "@/components/sections/cost";
import { Filesystem } from "@/components/sections/filesystem";
import { GetStarted } from "@/components/sections/get-started";
import { Hero } from "@/components/sections/hero";
import { OpenSource } from "@/components/sections/open-source";
import { Products } from "@/components/sections/products";
import { Search } from "@/components/sections/search";
import { getMessages } from "@/content/messages";
import { isLocale, type Locale } from "@/lib/i18n";
import { structuredData } from "@/lib/structured-data";

export const instant = false;

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale: raw } = await params;
  if (!isLocale(String(raw))) notFound();
  const locale = raw as Locale;
  const messages = getMessages(locale);

  return (
    <SitePage locale={locale} messages={messages}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <Hero locale={locale} messages={messages} />
      <Products locale={locale} messages={messages} />
      <Filesystem locale={locale} messages={messages} />
      <Architecture locale={locale} messages={messages} />
      <Search locale={locale} messages={messages} />
      <Benchmarks locale={locale} messages={messages} />
      <Cost locale={locale} messages={messages} />
      <OpenSource locale={locale} messages={messages} />
      <GetStarted locale={locale} messages={messages} />
    </SitePage>
  );
}
