import { Section } from "@/components/ui/section";
import { searchFeatures } from "@/content/products";
import { Bento } from "./bento";

export function Search() {
  return (
    <Section id="search" label="Search" title="Search by meaning, by keyword, or both.">
      <Bento features={searchFeatures} />
    </Section>
  );
}
