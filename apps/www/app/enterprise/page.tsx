import { pageMetadata } from "@/lib/metadata";

import { SitePage } from "@/components/layout/site-page";
import { Enterprise } from "@/components/sections/enterprise";
import { GetStarted } from "@/components/sections/get-started";

export const metadata = pageMetadata("/enterprise");

export default function EnterprisePage() {
  return (
    <SitePage>
      <Enterprise />
      <GetStarted />
    </SitePage>
  );
}
