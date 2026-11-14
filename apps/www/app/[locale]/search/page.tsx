import { pageMetadata } from "@/lib/metadata";

import { SearchArt } from "@/components/art/product-art";
import { SitePage } from "@/components/layout/site-page";
import { Benchmarks } from "@/components/sections/benchmarks";
import { GetStarted } from "@/components/sections/get-started";
import { ProductHero } from "@/components/sections/product-hero";
import { Search } from "@/components/sections/search";

export const metadata = pageMetadata("/search");

export default function SearchPage() {
  return (
    <SitePage>
      <ProductHero
        label="Search"
        title="Search everything in"
        accent="your bucket."
        line="Vector, full-text and hybrid search, straight from your object storage, served over an NVMe cache for blazing fast speed."
        docs="/indexes"
        art={<SearchArt />}
      />
      <Search />
      <Benchmarks show="search" />
      <GetStarted />
    </SitePage>
  );
}
