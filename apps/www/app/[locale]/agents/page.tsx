import { pageMetadata } from "@/lib/metadata";

import { SitePage } from "@/components/layout/site-page";
import { Agents } from "@/components/sections/agents";
import { GetStarted } from "@/components/sections/get-started";
import { ProductHero } from "@/components/sections/product-hero";
import { Sdks } from "@/components/sections/sdks";

export const metadata = pageMetadata("/agents");

export default function AgentsPage() {
  return (
    <SitePage>
      <ProductHero
        label="Agents"
        title="Plugs into every"
        accent="agent you run."
        line="An MCP server, a CLI, a console to watch them work, and SDKs in seven languages."
        docs="/agents/mcp"
      />
      <Agents />
      <Sdks />
      <GetStarted />
    </SitePage>
  );
}
