import { SitePage } from "@/components/layout/site-page";
import { GetStarted } from "@/components/sections/get-started";
import { UseCaseIndex } from "@/components/sections/use-case-index";
import { getMessages } from "@/content/messages";
import { pageMetadata } from "@/lib/metadata";
import { pageLocale } from "@/lib/page";
import { breadcrumbs, JsonLd } from "@/lib/structured-data";

export const instant = false;

export const generateMetadata = pageMetadata("/use-cases");

export default async function UseCases({ params }: PageProps<"/[locale]/use-cases">) {
  const locale = await pageLocale(params);
  const t = getMessages(locale);
  return (
    <SitePage locale={locale} messages={t}>
      <JsonLd data={breadcrumbs(locale, [{ name: t.footer.useCases, path: "/use-cases" }])} />
      <UseCaseIndex locale={locale} t={t} />
      <GetStarted t={t} />
    </SitePage>
  );
}
