import { Section } from "@/components/ui/section";
import { getMessages, type HomeMessages } from "@/content/messages";
import { defaultLocale, type Locale } from "@/lib/i18n";
import { Bento } from "./bento";

export function Search({
  locale = defaultLocale,
  messages,
}: {
  locale?: Locale;
  messages?: HomeMessages;
}) {
  const t = messages ?? getMessages(locale);
  return (
    <Section id="search" label={t.search.label} title={t.search.title} line={t.search.line}>
      <Bento features={t.search.features} />
    </Section>
  );
}
