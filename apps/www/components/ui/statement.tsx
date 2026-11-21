import type { ReactNode } from "react";

import { Eyebrow } from "@/components/ui/eyebrow";
import { Band } from "@/components/ui/frame";
import { cn } from "@/lib/utils";

/** The words that open a section: a label and a heading on the left, a line and an action on the right. */
export function Head({
  id,
  eyebrow,
  title,
  line,
  action,
  as: Heading = "h2",
  className,
}: {
  id?: string;
  eyebrow?: ReactNode;
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
        "grid gap-6 pt-24 pb-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-baseline-last lg:gap-16 lg:pt-36 lg:pb-14",
        className,
      )}
    >
      <div>
        {eyebrow && <Eyebrow className="mb-5">{eyebrow}</Eyebrow>}
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
