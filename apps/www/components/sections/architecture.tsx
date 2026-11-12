import { Layers } from "@/components/art/layers";
import { Container, Section } from "@/components/ui/section";

export function Architecture() {
  return (
    <Section
      id="architecture"
      label="How it works"
      title={
        <>
          Your data is served from a <span className="text-signal">fast NVMe cache</span>. It feels
          like a <span className="text-signal">local disk</span>.
        </>
      }
    >
      <Container>
        <Layers />
      </Container>
    </Section>
  );
}
