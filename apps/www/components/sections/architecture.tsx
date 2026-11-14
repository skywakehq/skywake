import { Layers } from "@/components/art/layers";
import { CARD, Container, Section } from "@/components/ui/section";
import { getMessages, type HomeMessages } from "@/content/messages";
import { files } from "@/content/numbers";
import { defaultLocale, type Locale } from "@/lib/i18n";

// Measured disk speed: a small write, a small read, and a full build.
const FIGURES = [0, 1, 3].map((i) => files.groups[1]!.stats[i]!.figure);

export function Architecture({
  locale = defaultLocale,
  messages,
}: {
  locale?: Locale;
  messages?: HomeMessages;
}) {
  const t = messages ?? getMessages(locale);
  return (
    <Section
      id="architecture"
      label={t.architecture.label}
      title={
        <>
          {t.architecture.titleBefore}{" "}
          <span className="text-signal">{t.architecture.titleAccent}</span>
        </>
      }
      line={t.architecture.line}
    >
      <Container>
        <Layers />
        <dl className="grid gap-3 sm:mt-3 sm:grid-cols-3">
          {t.architecture.stats.map((label, i) => (
            <div key={label} className={`${CARD} reveal flex flex-col-reverse p-6`}>
              <dt className="t-body mt-2 text-muted-foreground">{label}</dt>
              <dd className="t-num text-foreground">{FIGURES[i]}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </Section>
  );
}
