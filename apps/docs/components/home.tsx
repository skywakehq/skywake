import Link from "fumadocs-core/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@skywake/ui/components/logo";

/** The home page's opening: what Skywake is, and where to start. */
export function Hero({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions: { label: string; href: string }[];
}) {
  return (
    <section className="not-prose relative mb-12 overflow-hidden border-b pt-6 pb-12 sm:pt-10 sm:pb-14">
      {/* A dot grid fading out to the right: paper, not a picture. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_left,black_10%,transparent_75%)] [background-image:radial-gradient(var(--line-strong)_1.2px,transparent_1.2px)] [background-size:14px_14px]"
      />
      <div className="relative max-w-xl">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-muted py-1 pr-3 pl-1 text-xs text-muted-foreground">
          <span className="grid size-5 place-items-center rounded-full bg-foreground text-background">
            <Logo className="size-2.5" />
          </span>
          Documentation
        </span>
        <h1 className="sw-title">{title}</h1>
        <div className="mt-4 text-lg leading-relaxed text-pretty text-muted-foreground">
          {children}
        </div>
        <div className="mt-8 flex flex-wrap gap-2">
          {actions.map((action, i) => (
            <Link
              key={action.href}
              href={action.href}
              className={
                i === 0
                  ? "group inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
                  : "inline-flex h-9 items-center rounded-md bg-muted px-4 text-sm font-medium transition-colors hover:bg-accent"
              }
            >
              {action.label}
              {i === 0 && (
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              )}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/** A heading over a group of cards on the home page. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="not-prose mt-12">
      <h2 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}
