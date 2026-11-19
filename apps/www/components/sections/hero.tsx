import { ArrowRight, ArrowUpRight } from "lucide-react";
import { siGithub } from "simple-icons";

import { BrandIcon } from "@/components/ui/brand-icon";
import { SCREENS, Screen } from "@/components/ui/screen";
import type { HomeMessages } from "@/content/messages";
import { site } from "@/content/site";
import { Title } from "@/components/ui/frame";

export function Hero({ t }: { t: HomeMessages }) {
  const start = site.cloudOpen
    ? { href: site.consoleUrl, label: t.hero.getStartedCta }
    : { href: site.docsUrl, label: t.hero.docsCta };
  return (
    <>
      <section className="flex flex-col items-center px-6 pt-20 pb-16 text-center sm:px-10 lg:px-12 lg:pt-28 lg:pb-20">
        {!site.cloudOpen && (
          <a
            href="#waitlist"
            className="t-small mb-8 inline-flex items-center gap-2 rounded-full bg-(--soft) py-1.5 pr-3 pl-2.5 ring-1 ring-(--hairline)"
          >
            <span aria-hidden>🚀</span>
            <span className="shimmer-text">{t.hero.badge}</span>
            <ArrowRight className="size-3.5 text-muted-foreground" />
          </a>
        )}
        <h1 className="t-display t-regular max-w-[20ch] text-foreground">
          <Title before={t.hero.titleBefore} accent={t.hero.titleAccent} />
        </h1>
        <p className="t-lead mt-8 max-w-[52ch] text-muted-foreground">{t.hero.line}</p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <a href={start.href} className="btn btn-primary">
            {start.label} <ArrowUpRight className="size-4" />
          </a>
          {site.repoUrl && (
            <a href={site.repoUrl} className="btn btn-secondary">
              <BrandIcon icon={siGithub} className="size-4" />
              {t.openSource.star}
            </a>
          )}
        </div>
      </section>

      <div className="stage">
        <div className="stage-screen pl-6 sm:pl-10 lg:pl-12">
          <div className="screen-frame screen-lift h-80 overflow-hidden rounded-tl-xl border-t border-l border-foreground/15 bg-background sm:h-[26rem]">
            <Screen
              shot={SCREENS.search}
              alt={t.hero.screenshotAlt}
              priority
              sizes="(min-width: 72rem) 70rem, 100vw"
            />
          </div>
        </div>
      </div>
    </>
  );
}
