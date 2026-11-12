import { Section } from "@/components/ui/section";
import { searchFeatures } from "@/content/products";
import { Bento } from "./bento";

export function Search() {
  return (
    <Section id="search" label="Search" title="Every kind of search, on your bucket.">
      <Bento features={searchFeatures} />
    </Section>
  );
}
