import { ArrowUpRight } from "lucide-react";

import { Container } from "@/components/ui/section";
import { site } from "@/content/site";
import { WaitlistForm } from "./waitlist-form";

const QUIET_LINK =
  "t-small inline-flex items-center gap-1 text-background/60 transition-colors hover:text-background";

export function GetStarted() {
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
              <p className="t-eyebrow text-background/60">🚀 Skywake Cloud</p>
              <h2 className="t-h2 t-regular mt-4 max-w-[22ch]">Coming soon. Get in early.</h2>
              <p className="t-lead mt-4 max-w-[44ch] text-background/60">
                We run it for you, free to start. One email when it opens.
              </p>
              <div className="mt-10 flex w-full justify-center">
                <WaitlistForm />
              </div>
              <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2">
                <a href={site.docsUrl} className={QUIET_LINK}>
                  Or self-host it free today <ArrowUpRight className="size-3.5" />
                </a>
                {site.repoUrl && (
                  <a href={site.repoUrl} className={QUIET_LINK}>
                    Star on GitHub <ArrowUpRight className="size-3.5" />
                  </a>
                )}
              </div>
            </>
          ) : (
            <>
              <h2 className="t-h2 t-regular max-w-[22ch]">Start building with Skywake.</h2>
              <p className="t-lead mt-4 max-w-[46ch] text-background/60">
                Fast files and search for your agents and apps, on your own object storage.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-3">
                <a
                  href={site.consoleUrl}
                  className="btn bg-background text-foreground hover:opacity-90"
                >
                  Get started <ArrowUpRight className="size-3.5" />
                </a>
                {site.repoUrl && (
                  <a
                    href={site.repoUrl}
                    className="btn text-background ring-1 ring-background/25 hover:bg-background/10"
                  >
                    Star on GitHub
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
