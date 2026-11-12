import { BrandIcon } from "@/components/ui/brand-icon";
import { CopyButton } from "@/components/ui/copy-button";
import { CARD, Container, Section } from "@/components/ui/section";
import { sdks } from "@/content/agents";

export function Sdks() {
  return (
    <Section id="sdks" label="SDKs" title="Your language, the same API.">
      <Container>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sdks.map((sdk) => (
            <li key={sdk.name} className={`${CARD} flex flex-col gap-6 px-6 py-6`}>
              <p className="t-body flex items-center gap-2 font-medium text-foreground">
                <span className="text-muted-foreground">
                  <BrandIcon icon={sdk.icon} />
                </span>
                {sdk.name}
              </p>
              <p className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
                <span className="min-w-0 [overflow-wrap:anywhere]">{sdk.install}</span>
                <CopyButton text={sdk.install} />
              </p>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
