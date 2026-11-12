import { Section } from "@/components/ui/section";
import { fileFeatures } from "@/content/products";
import { Bento } from "./bento";

export function Filesystem() {
  return (
    <Section
      id="filesystem"
      label="Filesystem"
      title="Copy it, change it, merge it back. Nothing gets lost."
    >
      <Bento features={fileFeatures} />
    </Section>
  );
}
