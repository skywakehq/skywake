import { Layers } from "@/components/art/layers";
import { Container, Section } from "@/components/ui/section";
import { getMessages, type HomeMessages } from "@/content/messages";
import { defaultLocale, type Locale } from "@/lib/i18n";

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
          {t.architecture.titleBefore}
          <span className="text-signal">{t.architecture.titleCache}</span>
          {t.architecture.titleMid}
          <span className="text-signal">{t.architecture.titleDisk}</span>.
        </>
      }
      line={t.architecture.line}
    >
      <Container>
        <Layers />
      </Container>
    </Section>
  );
}
