import { SitePage } from "@/components/layout/site-page";
import { Cost } from "@/components/sections/cost";
import { GetStarted } from "@/components/sections/get-started";
import { Plans } from "@/components/sections/plans";
import { getMessages } from "@/content/messages";
import { pageMetadata } from "@/lib/metadata";
import { pageLocale } from "@/lib/page";

export const instant = false;

export const generateMetadata = pageMetadata("/pricing");

export default async function Pricing({ params }: PageProps<"/[locale]/pricing">) {
  const locale = await pageLocale(params);
  const t = getMessages(locale);
  return (
    <SitePage locale={locale} messages={t}>
      <Plans t={t} />
      <Cost t={t} />
      <GetStarted t={t} />
    </SitePage>
  );
}
