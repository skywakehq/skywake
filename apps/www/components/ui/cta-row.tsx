import { ArrowRight } from "lucide-react";

import { ConsoleLink } from "@/components/ui/console-link";
import type { HomeMessages } from "@/content/messages";
import { site } from "@/content/site";
import { cn } from "@/lib/utils";

const PRIMARY = "btn btn-primary";
const SECONDARY = "btn btn-secondary";

/**
 * The page's ask, repeated after the sections that land a point: get started
 * (or open the console, once signed in), with the docs beside it.
 */
export function CtaRow({
  t,
  label,
  docs = true,
  className,
}: {
  t: HomeMessages;
  /** Overrides "Get started" for a section with its own pitch. */
  label?: string;
  docs?: boolean;
  className?: string;
}) {
  const arrow = <ArrowRight className="size-4" />;
  return (
    <div className={cn("mt-10 flex flex-wrap items-center justify-center gap-3", className)}>
      {site.cloudOpen ? (
        <ConsoleLink
          className={PRIMARY}
          getStarted={label ?? t.nav.getStarted}
          open={t.nav.open}
          icon={arrow}
        />
      ) : (
        <a href="#waitlist" className={PRIMARY}>
          {t.hero.waitlistCta}
          {arrow}
        </a>
      )}
      {docs && (
        <a href={site.docsUrl} className={SECONDARY}>
          {t.hero.docsCta}
        </a>
      )}
    </div>
  );
}
