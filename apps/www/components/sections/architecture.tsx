import { Layers } from "@/components/art/layers";
import { Container, Section } from "@/components/ui/section";

export function Architecture() {
  return (
    <Section
      id="architecture"
      label="Architecture"
      title="Data is served over a shared NVMe SSD cache."
    >
      <Container>
        <Layers />
      </Container>
    </Section>
  );
}
