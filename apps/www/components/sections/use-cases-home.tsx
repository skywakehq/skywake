import Link from "next/link";
import { ArrowRight, Database, Eye, FlaskConical, Hammer, Headset, Share2 } from "lucide-react";

import { Container, Section } from "@/components/ui/section";
import { getMessages, type HomeMessages } from "@/content/messages";
import { defaultLocale, localizePath, type Locale } from "@/lib/i18n";
import { UseCaseScroll } from "./use-case-scroll";

// Same order as useCases.others.
const MORE_ICONS = [Hammer, Eye, Database, Headset, Share2, FlaskConical];

export function UseCases({
  locale = defaultLocale,
  messages,
}: {
  locale?: Locale;
  messages?: HomeMessages;
}) {
  const t = messages ?? getMessages(locale);
  const u = t.useCases;
  return (
    <Section
      id="use-cases"
      label={u.label}
      title={u.title}
      action={
        <Link href={localizePath(locale, "/use-cases")} className="btn btn-secondary">
          {u.more} <ArrowRight className="size-4" />
        </Link>
      }
    >
      <Container>
        <UseCaseScroll u={u} href={localizePath(locale, "/use-cases")} />

        <h3 className="t-h3 mt-20 text-foreground lg:mt-28">{u.moreTitle}</h3>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {u.others.map((other, i) => {
            const Icon = MORE_ICONS[i]!;
            return (
              <li key={other.name} className="reveal flex gap-4 rounded-2xl bg-(--soft) p-5">
                <Icon className="mt-0.5 size-5 shrink-0 text-signal" strokeWidth={1.75} />
                <div>
                  <p className="t-body font-medium text-foreground">{other.name}</p>
                  <p className="t-small mt-1 text-muted-foreground">{other.line}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Container>
    </Section>
  );
}
