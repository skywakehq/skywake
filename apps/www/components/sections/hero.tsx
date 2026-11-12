import { ArrowRight, ArrowUpRight } from "lucide-react";
import { siGithub } from "simple-icons";

import { HeroDemo } from "@/components/art/hero-demo";
import { BrandIcon } from "@/components/ui/brand-icon";
import { CARD, Container, Hatch } from "@/components/ui/section";
import { getMessages, type HomeMessages } from "@/content/messages";
import { site } from "@/content/site";
import { defaultLocale, type Locale } from "@/lib/i18n";

export function Hero({
  locale = defaultLocale,
  messages,
}: {
  locale?: Locale;
  messages?: HomeMessages;
}) {
  const t = messages ?? getMessages(locale);

  return (
    <section>
      <Container className="pt-14 pb-12 lg:pt-20 lg:pb-16">
        {!site.cloudOpen && (
          <a
            href="#waitlist"
            className="t-small mb-7 inline-flex items-center gap-2 rounded-full bg-(--soft) py-1.5 pr-3 pl-2.5 ring-1 ring-(--hairline) transition-colors hover:bg-(--hairline)"
          >
            <span className="shimmer-text">{t.hero.badge}</span>
            <ArrowRight className="size-3.5 text-muted-foreground" />
          </a>
        )}

        <h1 className="t-display t-regular max-w-[17ch] text-foreground sm:max-w-[18ch]">
          {t.hero.titleBefore} <span className="text-signal">{t.hero.titleAccent}</span>
        </h1>
        <p className="t-lead mt-6 max-w-[46ch] text-muted-foreground">{t.hero.subtitle}</p>
        <div className="mt-9 flex flex-wrap gap-3">
          {site.cloudOpen ? (
            <a href={site.consoleUrl} className="btn btn-primary">
              {t.hero.getStartedCta} <ArrowUpRight className="size-4" />
            </a>
          ) : (
            <a href="#waitlist" className="btn btn-primary">
              {t.hero.waitlistCta} <ArrowRight className="size-4" />
            </a>
          )}
          {site.repoUrl && (
            <a href={site.repoUrl} className="btn btn-secondary">
              <BrandIcon icon={siGithub} className="size-4" />
              {t.hero.starCta}
            </a>
          )}
          <a href={site.docsUrl} className="btn btn-secondary">
            {t.hero.docsCta} <ArrowUpRight className="size-4" />
          </a>
        </div>

        <div className={`${CARD} mt-12 overflow-hidden lg:mt-14`}>
          <HeroDemo messages={t} />
        </div>
      </Container>
      <Hatch />
    </section>
  );
}
