import { ArrowRight } from "lucide-react";

import { FolderShot } from "@/components/art/folder-shot";
import { ConsoleLink } from "@/components/ui/console-link";
import { AGENTS } from "@/components/ui/agent-logos";
import { InfinityLoop } from "@/components/ui/infinity-loop";
import type { HomeMessages } from "@/content/messages";
import { site } from "@/content/site";

/** The agents named under the hero: the few most people use. */
const POPULAR = ["Claude Code", "Codex", "Cursor", "Gemini", "Copilot", "Windsurf"];

export function Hero({ t }: { t: HomeMessages }) {
  const button = "btn btn-primary";
  return (
    <section className="relative isolate overflow-hidden pb-12 sm:pb-24">
      <div className="flex flex-col items-center px-6 pt-14 text-center sm:px-10 lg:pt-20">
        <h1 className="t-hero text-foreground">
          {t.hero.titleBefore}
          <InfinityLoop className="mx-[0.14em] inline-block h-[0.6em] w-auto -translate-y-[0.04em] align-baseline" />
          <span className="text-muted-foreground">{t.hero.titleAccent}</span>
        </h1>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {site.cloudOpen ? (
            <ConsoleLink
              className={button}
              getStarted={t.hero.getStartedCta}
              open={t.nav.open}
              icon={<ArrowRight className="size-4" />}
            />
          ) : (
            <a href="#waitlist" className={button}>
              {t.hero.waitlistCta}
              <ArrowRight className="size-4" />
            </a>
          )}
          <a
            href={site.docsUrl}
            className="btn btn-secondary"
          >
            {t.hero.docsCta}
          </a>
        </div>
        <div className="mt-12 grid w-full justify-items-center sm:mt-16">
          <FolderShot />
        </div>
        <div className="mt-10 grid w-full max-w-5xl justify-items-center sm:mt-16">
          <ul
            aria-label={t.hero.worksWith}
            className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4"
          >
            {AGENTS.filter((agent) => POPULAR.includes(agent.name)).map((agent) => (
              <li
                key={agent.name}
                className="flex items-center gap-2 text-[15px] font-medium tracking-tight text-muted-foreground/80 transition-colors hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" aria-hidden className="size-[18px] fill-current">
                  <path d={agent.icon.path} />
                </svg>
                {agent.name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
