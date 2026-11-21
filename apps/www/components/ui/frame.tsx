import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Frame({ children }: { children: ReactNode }) {
  return <div className="relative mx-auto -mt-[4.25rem] max-w-6xl pt-[4.25rem]">{children}</div>;
}

export function Band({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section id={id} className={cn("relative scroll-mt-24", className)}>
      {children}
    </section>
  );
}

/** A title in two parts: the second part is quieter. A mark can sit between them. */
export function Title({
  before,
  accent,
  mark,
}: {
  before: string;
  accent: string;
  mark?: ReactNode;
}) {
  return (
    <>
      {before && `${before.trimEnd()} `}
      {mark}
      <span className="text-muted-foreground">{accent}</span>
    </>
  );
}
