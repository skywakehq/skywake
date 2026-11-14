import { notFound } from "next/navigation";

import { SitePage } from "@/components/layout/site-page";
import { GetStarted } from "@/components/sections/get-started";
import { UseCaseIndex } from "@/components/sections/use-case-index";
import { getMessages } from "@/content/messages";
import { isLocale, type Locale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/metadata";

export const instant = false;

export const metadata = pageMetadata("/use-cases");

export default async function UseCasesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const messages = getMessages(locale);

  return (
    <SitePage locale={locale} messages={messages}>
      <UseCaseIndex locale={locale} />
      <GetStarted locale={locale} messages={messages} />
    </SitePage>
  );
}
