import { ArrowUpRight } from "lucide-react";

import { Container } from "@/components/ui/section";
import { site } from "@/content/site";

export function GetStarted() {
  return (
    <section id="get-started" className="relative scroll-mt-20 pt-24 sm:pt-32">
      <Container>
        <div className="relative isolate flex flex-col items-center overflow-hidden rounded-3xl bg-foreground px-6 py-20 text-center text-background sm:py-28">
          <div aria-hidden className="cta-glow" />
          <div aria-hidden className="cta-grain" />
          <h2 className="t-h2 t-regular max-w-[22ch]">Start building with Skywake.</h2>
          <p className="t-lead mt-4 max-w-[46ch] text-background/60">
            Fast files and search for your agents and apps, on your own object storage.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <a href={site.docsUrl} className="btn bg-background text-foreground hover:opacity-90">
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
        </div>
      </Container>
    </section>
  );
}
