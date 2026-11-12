import { Container, Section } from "@/components/ui/section";
import { enterpriseFeatures } from "@/content/enterprise";

export function Enterprise() {
  return (
    <Section id="enterprise" label="Enterprise" title="Ready for your security review.">
      <Container>
        <ul className="border-t border-border">
          {enterpriseFeatures.map((feature, i) => (
            <li
              key={feature.name}
              className="grid gap-x-8 gap-y-3 border-b border-border py-6 lg:grid-cols-[12rem_minmax(0,22rem)_minmax(0,1fr)] lg:items-center"
            >
              <p className="t-mono text-muted-foreground">
                {String(i + 1).padStart(2, "0")} ·{" "}
                <span className="text-foreground">{feature.name}</span>
              </p>
              <p className="t-body text-foreground">{feature.line}</p>
              <p className="t-mono flex items-center gap-2 text-foreground">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-signal" />
                {feature.fact}
              </p>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
