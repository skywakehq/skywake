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
import { breadcrumbs, guideArticle, JsonLd } from "@/lib/structured-data";

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
  });
}

export default async function UseCase({ params }: PageProps<"/[locale]/use-cases/[slug]">) {
  const { slug } = await params;
  const locale = await pageLocale(params);
  const item = findUseCase(slug);
  if (!item) notFound();
  const t = getMessages(locale);
  const copy = t.guides.items[item.id]!;
  const path = `/use-cases/${item.id}`;
  return (
    <SitePage locale={locale} messages={t}>
      <JsonLd
        data={[
          guideArticle(locale, { path, title: copy.title, description: copy.lead }),
          breadcrumbs(locale, [
            { name: t.footer.useCases, path: "/use-cases" },
            { name: copy.title, path },
          ]),
        ]}
      />
      <Guide id={item.id} locale={locale} t={t} />
      <UseCaseRelated useCase={item} locale={locale} t={t} />
      <GetStarted t={t} />
    </SitePage>
  );
}
