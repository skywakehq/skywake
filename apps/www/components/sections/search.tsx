import { Section } from "@/components/ui/section";
import { getMessages, type HomeMessages } from "@/content/messages";
import { defaultLocale, type Locale } from "@/lib/i18n";
import { Bento } from "./bento";

export function Search({
  locale = defaultLocale,
  messages,
  short = false,
}: {
  locale?: Locale;
  messages?: HomeMessages;
  /** The homepage shows only the three main ways to search. */
  short?: boolean;
}) {
  const t = messages ?? getMessages(locale);
  const features = short
    ? t.search.features.slice(0, 3).map((f) => ({ ...f, span: 2 as const }))
    : t.search.features;
  return (
    <Section id="search" label={t.search.label} title={t.search.title} line={t.search.line}>
      <Bento features={features} />
    </Section>
  );
}
