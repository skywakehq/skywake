import { ArrowUpRight } from "lucide-react";

import { Container } from "@/components/ui/section";
import { getMessages, type HomeMessages } from "@/content/messages";
import { site } from "@/content/site";
import { defaultLocale, type Locale } from "@/lib/i18n";
import { WaitlistForm } from "./waitlist-form";

const QUIET_LINK =
  "t-small inline-flex items-center gap-1 text-background/60 transition-colors hover:text-background";

export function GetStarted({
  locale = defaultLocale,
  messages,
}: {
  locale?: Locale;
  messages?: HomeMessages;
}) {
  const t = messages ?? getMessages(locale);
  const waitlist = !site.cloudOpen;
  return (
    <section
      id={waitlist ? "waitlist" : "get-started"}
      className="relative scroll-mt-20 pt-24 sm:pt-32"
    >
      <Container>
        <div className="relative isolate flex flex-col items-center overflow-hidden rounded-3xl bg-foreground px-6 py-20 text-center text-background sm:py-28">
          <div aria-hidden className="cta-glow" />
          <div aria-hidden className="cta-grain" />
          {waitlist ? (
            <>
              <p className="t-eyebrow text-background/60">{t.waitlist.eyebrow}</p>
              <h2 className="t-h2 t-regular mt-4 max-w-[24ch]">{t.waitlist.title}</h2>
              <p className="t-lead mt-4 max-w-[46ch] text-background/60">{t.waitlist.line}</p>
              <div className="mt-10 flex w-full justify-center">
                <WaitlistForm />
              </div>
              <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2">
                <a href={site.docsUrl} className={QUIET_LINK}>
                  {t.waitlist.selfHost} <ArrowUpRight className="size-3.5" />
                </a>
                {site.repoUrl && (
                  <a href={site.repoUrl} className={QUIET_LINK}>
                    {t.waitlist.star} <ArrowUpRight className="size-3.5" />
                  </a>
                )}
              </div>
            </>
          ) : (
            <>
              <h2 className="t-h2 t-regular max-w-[24ch]">{t.waitlist.openTitle}</h2>
              <p className="t-lead mt-4 max-w-[46ch] text-background/60">{t.waitlist.openLine}</p>
              <div className="mt-10 flex flex-wrap justify-center gap-3">
                <a
                  href={site.consoleUrl}
                  className="btn bg-background text-foreground hover:opacity-90"
                >
                  {t.waitlist.openCta} <ArrowUpRight className="size-3.5" />
                </a>
                {site.repoUrl && (
                  <a
                    href={site.repoUrl}
                    className="btn text-background ring-1 ring-background/25 hover:bg-background/10"
                  >
                    {t.waitlist.star}
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </Container>
    </section>
  );
}
