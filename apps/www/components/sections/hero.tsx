import { ArrowUpRight } from "lucide-react";

import { Container, Hatch } from "@/components/ui/section";
import { site } from "@/content/site";

export function Hero() {
  return (
    <section>
      <Container className="pt-16 pb-16 lg:pt-24 lg:pb-20">
        <h1 className="t-display t-regular text-foreground">
          Blazing fast files and search infrastructure
          <br />
          <span className="text-signal">for your agents</span> &{" "}
          <span className="text-signal">apps.</span>
        </h1>
        <div className="mt-10 flex flex-wrap gap-3">
          <a href="#get-started" className="btn btn-primary">
            Get started <ArrowUpRight className="size-4" />
          </a>
          {site.repoUrl && (
            <a href={site.repoUrl} className="btn btn-secondary">
              Star on GitHub
            </a>
          )}
        </div>
      </Container>
      <Hatch />
    </section>
  );
}
