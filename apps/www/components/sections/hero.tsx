import { ArrowRight, ArrowUpRight } from "lucide-react";
import { siGithub } from "simple-icons";

import { BrandIcon } from "@/components/ui/brand-icon";
import { Container, Hatch } from "@/components/ui/section";
import { site } from "@/content/site";

export function Hero() {
  return (
    <section>
      <Container className="pt-16 pb-16 lg:pt-24 lg:pb-20">
        {!site.cloudOpen && (
          <a
            href="#waitlist"
            className="t-small mb-8 inline-flex items-center gap-2 rounded-full bg-(--soft) py-1.5 pr-3 pl-2.5 ring-1 ring-(--hairline)"
          >
            <span aria-hidden>🚀</span>
            <span className="shimmer-text">Skywake Cloud is coming. Join the waitlist</span>
            <ArrowRight className="size-3.5 text-muted-foreground" />
          </a>
        )}
        <h1 className="t-display t-regular text-foreground">
          Blazing fast files and search infrastructure
          <br />
          <span className="text-signal">for your agents</span> &{" "}
          <span className="text-signal">apps.</span>
        </h1>
        <div className="mt-10 flex flex-wrap gap-3">
          {site.cloudOpen ? (
            <a href={site.consoleUrl} className="btn btn-primary">
              Get started <ArrowUpRight className="size-4" />
            </a>
          ) : (
            <a href="#waitlist" className="btn btn-primary">
              Join the Cloud waitlist <ArrowRight className="size-4" />
            </a>
          )}
          {site.repoUrl && (
            <a href={site.repoUrl} className="btn btn-secondary">
              <BrandIcon icon={siGithub} className="size-4" />
              Star on GitHub
            </a>
          )}
        </div>
      </Container>
      <Hatch />
    </section>
  );
}
