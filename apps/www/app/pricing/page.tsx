import { pageMetadata } from "@/lib/metadata";

import { SitePage } from "@/components/layout/site-page";
import { Cost } from "@/components/sections/cost";
import { GetStarted } from "@/components/sections/get-started";
import { Plans } from "@/components/sections/plans";

export const metadata = pageMetadata("/pricing");

export default function PricingPage() {
  return (
    <SitePage>
      <Plans />
      <Cost />
      <GetStarted />
    </SitePage>
  );
}
