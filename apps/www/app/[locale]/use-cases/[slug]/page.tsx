import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SitePage } from "@/components/layout/site-page";
import { Guide } from "@/components/guides";
import { GetStarted } from "@/components/sections/get-started";
import { UseCaseRelated } from "@/components/sections/use-case-page";
import { getMessages } from "@/content/messages";
import { findUseCase, useCases } from "@/content/use-cases";
import { buildMetadata } from "@/lib/metadata";
import { pageLocale } from "@/lib/page";

export const instant = false;

export function generateStaticParams() {
  return useCases.map((item) => ({ slug: item.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/use-cases/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const locale = await pageLocale(params);
  const copy = getMessages(locale).guides.items[slug];
  if (!copy) return {};
  return buildMetadata({
    locale,
    path: `/use-cases/${slug}`,
    title: copy.title,
    description: copy.lead,
    image: "use-cases",
  });
}

export default async function UseCase({ params }: PageProps<"/[locale]/use-cases/[slug]">) {
  const { slug } = await params;
  const locale = await pageLocale(params);
  const item = findUseCase(slug);
  if (!item) notFound();
  const t = getMessages(locale);
  return (
    <SitePage locale={locale} messages={t}>
      <Guide id={item.id} locale={locale} t={t} />
      <UseCaseRelated useCase={item} locale={locale} t={t} />
      <GetStarted t={t} />
    </SitePage>
  );
}
