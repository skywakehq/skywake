import { SitePage } from "@/components/layout/site-page";
import { Cost } from "@/components/sections/cost";
import { GetStarted } from "@/components/sections/get-started";
import { Plans } from "@/components/sections/plans";
import { getMessages } from "@/content/messages";
import { pageMetadata } from "@/lib/metadata";
import { pageLocale } from "@/lib/page";
import { breadcrumbs, JsonLd } from "@/lib/structured-data";

export const instant = false;

export const generateMetadata = pageMetadata("/pricing");

export default async function Pricing({ params }: PageProps<"/[locale]/pricing">) {
  const locale = await pageLocale(params);
  const t = getMessages(locale);
  return (
    <SitePage locale={locale} messages={t}>
      <JsonLd data={breadcrumbs(locale, [{ name: t.nav.pricing, path: "/pricing" }])} />
      <Plans t={t} />
      <Cost t={t} />
      <GetStarted t={t} />
    </SitePage>
  );
}
