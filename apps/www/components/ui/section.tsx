import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const CARD = "rounded-3xl border border-border bg-card";

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}>{children}</div>;
}

export function Hatch({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("border-y border-border", className)}>
      <div className="hatch mx-auto h-8 w-full max-w-6xl" />
    </div>
  );
}

export function SectionHead({
  label,
  title,
  action,
  numbered,
}: {
  label: string;
  title: ReactNode;
  action?: ReactNode;
  numbered?: boolean;
}) {
  return (
    <div className="mt-24 lg:mt-32">
      <Hatch />
      <Container className="flex flex-wrap items-end justify-between gap-8 pt-14 pb-16 lg:pt-20">
        <div>
          <p className={cn("t-eyebrow text-muted-foreground", numbered && "section-label")}>
            {label}
          </p>
          <h2 className="t-h2 t-regular mt-4 max-w-[30ch] text-foreground">{title}</h2>
        </div>
        {action}
      </Container>
    </div>
  );
}

export function Section({
  id,
  label,
  title,
  action,
  children,
}: {
  id: string;
  label: string;
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="relative scroll-mt-20">
      <SectionHead label={label} title={title} action={action} numbered />
      {children}
    </section>
  );
}
