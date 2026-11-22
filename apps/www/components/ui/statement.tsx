import type { ReactNode } from "react";

import { Band } from "@/components/ui/frame";
import { cn } from "@/lib/utils";

/** The words that open a section: a heading on the left, a line and an action on the right. */
export function Head({
  id,
  title,
  line,
  action,
  as: Heading = "h2",
  className,
}: {
  id?: string;
  title: ReactNode;
  line?: ReactNode;
  action?: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <Band
      id={id}
      className={cn(
        "grid gap-4 pt-16 pb-8 sm:gap-6 sm:pt-24 sm:pb-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-baseline-last lg:gap-16 lg:pt-36 lg:pb-14",
        className,
      )}
    >
      <div>
        <Heading className="t-h2 max-w-[20ch] text-balance text-foreground">{title}</Heading>
      </div>
      {(line || action) && (
        <div>
          {line && <p className="t-lead max-w-[46ch] text-muted-foreground">{line}</p>}
          {action && <div className={line ? "mt-6" : undefined}>{action}</div>}
        </div>
      )}
    </Band>
  );
}
