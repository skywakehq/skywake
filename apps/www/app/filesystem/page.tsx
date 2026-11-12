import { pageMetadata } from "@/lib/metadata";

import { ForkArt } from "@/components/art/product-art";
import { SitePage } from "@/components/layout/site-page";
import { Benchmarks } from "@/components/sections/benchmarks";
import { Cost } from "@/components/sections/cost";
import { Filesystem } from "@/components/sections/filesystem";
import { GetStarted } from "@/components/sections/get-started";
import { ProductHero } from "@/components/sections/product-hero";

export const metadata = pageMetadata("/filesystem");

export default function FilesystemPage() {
  return (
    <SitePage>
      <ProductHero
        label="Filesystem"
        title="Your bucket, as a"
        accent="fast local disk."
        line="Mount your object storage as a normal folder. Give each agent its own copy in milliseconds, then merge the changes back."
        docs="/filesystem/branches"
        art={<ForkArt />}
      />
      <Filesystem />
      <Benchmarks show="files" />
      <Cost />
      <GetStarted />
    </SitePage>
  );
}
