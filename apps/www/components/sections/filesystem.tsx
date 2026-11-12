import { Section } from "@/components/ui/section";
import { getMessages, type HomeMessages } from "@/content/messages";
import { defaultLocale, type Locale } from "@/lib/i18n";
import { Bento } from "./bento";

export function Filesystem({
  locale = defaultLocale,
  messages,
}: {
  locale?: Locale;
  messages?: HomeMessages;
}) {
  const t = messages ?? getMessages(locale);
  return (
    <Section
      id="filesystem"
      label={t.filesystem.label}
      title={t.filesystem.title}
      line={t.filesystem.line}
    >
      <Bento features={t.filesystem.features} />
    </Section>
  );
}
