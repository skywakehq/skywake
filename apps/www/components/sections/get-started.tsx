import { ArrowUpRight } from "lucide-react";
import type { CSSProperties } from "react";

import { WaitlistForm } from "@/components/sections/waitlist-form";
import { ConsoleLink } from "@/components/ui/console-link";
import { Band } from "@/components/ui/frame";
import type { HomeMessages } from "@/content/messages";
import { site } from "@/content/site";

const INK = {
  "--background": "var(--sun-ink)",
  "--foreground": "#ffe9a8",
} as CSSProperties;

const QUIET_LINK =
  "t-small inline-flex items-center gap-1 text-(--sun-ink)/70 transition-colors hover:text-(--sun-ink)";

/** The page's last word, written on the front of one big folder. */
export function GetStarted({ t }: { t: HomeMessages }) {
  const w = t.waitlist;
  const waitlist = !site.cloudOpen;
  return (
    <Band id={waitlist ? "waitlist" : "get-started"} className="mt-28 pt-10 lg:mt-40">
      <div
        aria-hidden
        className="absolute top-0 left-8 h-24 w-44 rounded-t-[1.75rem] bg-(--sun-deep) sm:left-14 sm:w-64"
      />
      <div
        aria-hidden
        className="sheet absolute top-2 right-10 hidden h-40 w-56 rotate-3 gap-2.5 p-5 sm:grid sm:content-start lg:right-24"
      >
        {["w-2/3", "w-full", "w-5/6"].map((width) => (
          <span key={width} className={`h-2 rounded-full bg-(--paper-ink)/15 ${width}`} />
        ))}
      </div>
      <div className="relative flex min-h-[26rem] flex-col items-center justify-center rounded-[2.25rem] bg-linear-to-b from-[#ffdf6e] to-[#f7b52c] px-6 py-24 text-center text-(--sun-ink) shadow-[inset_0_2px_0_rgb(255_255_255/0.65),0_-10px_30px_-18px_rgb(0_0_0/0.5)] lg:min-h-[36rem] lg:py-32">
        {waitlist ? (
          <>
            <p className="text-sm font-medium opacity-70">{w.eyebrow}</p>
            <h2 className="t-h2 mt-5 max-w-[32ch] text-balance">{w.title}</h2>
            <p className="t-lead mt-4 max-w-[40ch] opacity-75">{w.line}</p>
            <div style={INK} className="mt-10 flex w-full justify-center text-left">
              <WaitlistForm t={w.form} />
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2">
              <a href={site.docsUrl} className={QUIET_LINK}>
                {w.selfHost} <ArrowUpRight className="size-3.5" />
              </a>
              {site.repoUrl && (
                <a href={site.repoUrl} className={QUIET_LINK}>
                  {w.star} <ArrowUpRight className="size-3.5" />
                </a>
              )}
            </div>
          </>
        ) : (
          <>
            <h2 className="t-h2 max-w-[32ch] text-balance">{w.openTitle}</h2>
            <p className="t-lead mt-4 max-w-[40ch] opacity-75">{w.openLine}</p>
            <div style={INK} className="mt-10 flex flex-wrap justify-center gap-3">
              <ConsoleLink
                className="btn bg-background text-foreground"
                getStarted={w.openCta}
                open={t.nav.open}
                icon={<ArrowUpRight className="size-3.5" />}
              />
              {site.repoUrl && (
                <a href={site.repoUrl} className="btn bg-background/10 text-background">
                  {w.star}
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </Band>
  );
}
