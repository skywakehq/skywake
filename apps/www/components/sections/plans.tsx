import { ArrowRight, ArrowUpRight, Check } from "lucide-react";

import type { HomeMessages } from "@/content/messages";
import { site } from "@/content/site";
import { FolderIcon } from "@/components/ui/folder-icon";
import { Band } from "@/components/ui/frame";
import { ConsoleLink } from "@/components/ui/console-link";
import { Head } from "@/components/ui/statement";
import { cn } from "@/lib/utils";

// Launch is the plan most teams start on, so it stands out.
const FEATURED = 1;

/** The cloud plans, then a row for running it yourself. */
export function Plans({ t }: { t: HomeMessages }) {
  const p = t.plans;
  return (
    <>
      <Head as="h1" id="pricing" title={p.title} line={p.line} />
      <Band>
        <ol className="grid gap-4 md:grid-cols-3">
          {p.options.map((option, i) => {
            const featured = i === FEATURED;
            const button = cn("btn", featured ? "btn-primary" : "btn-secondary");
            return (
              <li
                key={option.name}
                className={cn("panel flex flex-col px-6 py-10 sm:px-8", featured && "panel-sun")}
              >
                <p className="t-body flex items-center gap-2.5 font-medium text-foreground">
                  {featured && <FolderIcon className="h-5 w-auto -rotate-6" />}
                  {option.name}
                </p>
                <p className="mt-6 flex items-baseline gap-2">
                  <span className="t-num text-foreground">{option.price}</span>
                  <span className="t-small text-muted-foreground">{option.per}</span>
                </p>
                <p className="t-body mt-4 text-muted-foreground">{option.line}</p>
                <ul className="mt-8 flex flex-col gap-3">
                  {option.includes.map((item) => (
                    <li key={item} className="t-body flex items-start gap-2.5 text-foreground">
                      <Check aria-hidden className="mt-1 size-4 shrink-0 text-signal" />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-12">
                  {site.cloudOpen ? (
                    <ConsoleLink
                      className={button}
                      getStarted={t.nav.getStarted}
                      open={t.nav.open}
                      icon={<ArrowRight className="size-4" />}
                    />
                  ) : (
                    <a href="#waitlist" className={button}>
                      {t.hero.waitlistCta}
                      <ArrowRight className="size-4" />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="panel mt-4 flex flex-col gap-6 px-6 py-8 sm:flex-row sm:items-center sm:px-8">
          <div className="min-w-0 flex-1">
            <p className="t-body font-medium text-foreground">{p.selfHost.name}</p>
            <p className="t-body mt-1 text-muted-foreground">{p.selfHost.line}</p>
          </div>
          <a href={site.docsUrl} className="btn btn-secondary shrink-0">
            {p.selfHost.action}
            <ArrowUpRight className="size-4" />
          </a>
        </div>
      </Band>
    </>
  );
}
