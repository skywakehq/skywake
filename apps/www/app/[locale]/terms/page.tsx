import { SitePage } from "@/components/layout/site-page";
import { Legal } from "@/components/sections/legal";
import { getMessages } from "@/content/messages";
import { pageMetadata } from "@/lib/metadata";
import { pageLocale } from "@/lib/page";
import { breadcrumbs, JsonLd } from "@/lib/structured-data";

export const instant = false;

export const generateMetadata = pageMetadata("/terms");

export default async function Terms({ params }: PageProps<"/[locale]/terms">) {
  const locale = await pageLocale(params);
  const t = getMessages(locale);
  return (
    <SitePage locale={locale} messages={t}>
      <JsonLd data={breadcrumbs(locale, [{ name: t.footer.terms, path: "/terms" }])} />
      <Legal t={t} page="terms" />
    </SitePage>
  );
}
