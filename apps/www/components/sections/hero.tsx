import { ArrowRight } from "lucide-react";

import { FolderShot } from "@/components/art/folder-shot";
import { InfinityLoop } from "@/components/ui/infinity-loop";
import type { HomeMessages } from "@/content/messages";
import { site } from "@/content/site";

export function Hero({ t }: { t: HomeMessages }) {
  const primary = site.cloudOpen
    ? { href: site.consoleUrl, label: t.hero.getStartedCta }
    : { href: "#waitlist", label: t.hero.waitlistCta };
  return (
    <section className="relative isolate overflow-hidden pb-24">
      <div className="flex flex-col items-center px-6 pt-14 text-center sm:px-10 lg:pt-20">
        {!site.cloudOpen && (
          <a
            href="#waitlist"
            className="t-small mb-8 inline-flex items-center gap-2 rounded-full bg-(--soft) py-1.5 pr-3 pl-3 ring-1 ring-(--hairline) backdrop-blur"
          >
            <span aria-hidden className="size-1.5 rounded-full bg-signal" />
            <span className="shimmer-text">{t.hero.badge}</span>
            <ArrowRight className="size-3.5 text-muted-foreground" />
          </a>
        )}
        <h1 className="t-hero text-foreground">
          {t.hero.titleBefore}
          <InfinityLoop className="mx-[0.14em] inline-block h-[0.6em] w-auto -translate-y-[0.04em] align-baseline" />
          <span className="text-muted-foreground">{t.hero.titleAccent}</span>
        </h1>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href={primary.href}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-85"
          >
            {primary.label}
            <ArrowRight className="size-4" />
          </a>
          <a
            href={site.docsUrl}
            className="inline-flex h-11 items-center rounded-full bg-background/40 px-5 text-sm font-medium text-foreground ring-1 ring-border backdrop-blur transition-colors hover:bg-(--soft)"
          >
            {t.hero.docsCta}
          </a>
        </div>
        <div className="mt-16 w-full">
          <FolderShot worksWith={t.hero.worksWith} />
        </div>
      </div>
    </section>
  );
}
