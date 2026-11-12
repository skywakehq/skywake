import { Section } from "@/components/ui/section";
import { fileFeatures } from "@/content/products";
import { Bento } from "./bento";

export function Filesystem() {
  return (
    <Section
      id="filesystem"
      label="Filesystem"
      title="Every agent works on its own copy. You decide what to keep."
    >
      <Bento features={fileFeatures} />
    </Section>
  );
}
