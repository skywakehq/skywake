import { CARD, Container, Section } from "@/components/ui/section";
import { tools } from "@/content/agents";

export function Agents() {
  return (
    <Section id="agents" label="Agents & tools" title="Plugs into every agent you run.">
      <Container>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tools.map((tool, i) => (
            <li key={tool.label} className={`${CARD} flex flex-col px-6 py-8`}>
              <p className="t-mono text-muted-foreground">
                0{i + 1} · <span className="text-foreground">{tool.label}</span>
              </p>
              <p className="t-h3 mt-6 text-foreground">{tool.title}</p>
              <p className="t-body mt-2 text-muted-foreground">{tool.line}</p>
              <p className="t-mono mt-auto flex items-center gap-2 pt-10 text-foreground">
                <span aria-hidden className="size-1.5 rounded-full bg-signal" />
                {tool.fact}
              </p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
