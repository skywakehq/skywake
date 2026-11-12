import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { siGithub } from "simple-icons";

import { BrandIcon } from "@/components/ui/brand-icon";
import { CARD, Container } from "@/components/ui/section";
import { site } from "@/content/site";

export function ProductHero({
  label,
  title,
  accent,
  line,
  docs,
  art,
}: {
  label: string;
  title: string;
  accent: string;
  line: string;
  docs: string;
  art?: ReactNode;
}) {
  return (
    <section>
      <Container className="pt-20 pb-12 lg:pt-28">
        <p className="t-eyebrow text-muted-foreground">{label}</p>
        <h1 className="t-display t-regular mt-5 text-foreground">
          {title} <span className="text-signal">{accent}</span>
        </h1>
        <p className="t-lead mt-6 max-w-[52ch] text-muted-foreground">{line}</p>
        <div className="mt-10 flex flex-wrap gap-3">
          <a href={`${site.docsUrl}${docs}`} className="btn btn-primary">
            Get started <ArrowUpRight className="size-4" />
          </a>
          {site.repoUrl && (
            <a href={site.repoUrl} className="btn btn-secondary">
              <BrandIcon icon={siGithub} className="size-4" />
              Star on GitHub
            </a>
          )}
        </div>
      </Container>
      {art && (
        <Container>
          <div aria-hidden className={`${CARD} overflow-hidden p-6 sm:p-8`}>
            {art}
          </div>
        </Container>
      )}
    </section>
  );
}
