import { SitePage } from "@/components/layout/site-page";
import { Architecture } from "@/components/sections/architecture";
import { Benchmarks } from "@/components/sections/benchmarks";
import { Cost } from "@/components/sections/cost";
import { Filesystem } from "@/components/sections/filesystem";
import { GetStarted } from "@/components/sections/get-started";
import { Hero } from "@/components/sections/hero";
import { OpenSource } from "@/components/sections/open-source";
import { Products } from "@/components/sections/products";
import { Search } from "@/components/sections/search";
import { pageMetadata } from "@/lib/metadata";
import { structuredData } from "@/lib/structured-data";

export const metadata = pageMetadata("/");

export default function Home() {
  return (
    <SitePage>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <Hero />
      <Products />
      <Filesystem />
      <Architecture />
      <Search />
      <Benchmarks />
      <Cost />
      <OpenSource />
      <GetStarted />
    </SitePage>
  );
}
