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
  line,
  action,
}: {
  label: string;
  title: ReactNode;
  line?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mt-24 lg:mt-32">
      <Hatch />
      <Container className="flex flex-wrap items-end justify-between gap-8 pt-14 pb-12 lg:pt-20 lg:pb-14">
        <div className="max-w-[42rem]">
          <p className="t-eyebrow text-muted-foreground">{label}</p>
          <h2 className="t-h2 t-regular mt-4 max-w-[28ch] text-foreground">{title}</h2>
          {line && <p className="t-lead mt-5 max-w-[48ch] text-muted-foreground">{line}</p>}
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
  line,
  action,
  children,
}: {
  id: string;
  label: string;
  title: ReactNode;
  line?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="relative scroll-mt-20">
      <SectionHead label={label} title={title} line={line} action={action} />
      {children}
    </section>
  );
}
