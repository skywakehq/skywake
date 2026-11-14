import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SitePage } from "@/components/layout/site-page";
import { GetStarted } from "@/components/sections/get-started";
import {
  UseCaseBenefits,
  UseCaseFlow,
  UseCaseHero,
  UseCasePains,
  UseCaseRelated,
  UseCaseTry,
} from "@/components/sections/use-case-page";
import { getMessages } from "@/content/messages";
import { findUseCase, useCases } from "@/content/use-cases";
import { isLocale, type Locale } from "@/lib/i18n";
import { buildMetadata } from "@/lib/metadata";

type Props = { params: Promise<{ locale: string; slug: string }> };

export const instant = false;

export function generateStaticParams() {
  return useCases.map((item) => ({ slug: item.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = findUseCase(slug);
  if (!item) return {};
  return buildMetadata({
    path: `/use-cases/${item.id}`,
    title: `${item.name}: ${item.title.replace(/\.$/, "")}`,
    description: item.lead,
    image: "use-cases",
  });
}

export default async function UseCasePage({ params }: Props) {
  const { locale: raw, slug } = await params;
  const item = findUseCase(slug);
  if (!isLocale(raw) || !item) notFound();
  const locale: Locale = raw;
  const messages = getMessages(locale);

  return (
    <SitePage locale={locale} messages={messages}>
      <UseCaseHero useCase={item} locale={locale} messages={messages} />
      <UseCasePains useCase={item} />
      <UseCaseFlow useCase={item} />
      <UseCaseBenefits useCase={item} />
      <UseCaseTry useCase={item} />
      <UseCaseRelated useCase={item} locale={locale} />
      <GetStarted locale={locale} messages={messages} />
    </SitePage>
  );
}
