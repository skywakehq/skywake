"use client";

import { Search } from "lucide-react";
import { type ComponentType, Fragment, type ReactNode } from "react";
import { cn } from "@skywake/ui/lib/utils";
import { Separator } from "@skywake/ui/components/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@skywake/ui/components/sidebar";

/**
 * The console's frame: an inset sidebar and a panel beside it that fills the
 * window. Nothing scrolls the page; the panel's body scrolls, or with
 * `scroll={false}` leaves that to its children, so the sidebar and top bar
 * stay put. The frame clips rather than hides its overflow: a hidden box can
 * still be scrolled, and jumping to a #heading would push the top bar away.
 */
export function AppShell({
  sidebar,
  topBar,
  sidebarOpen = true,
  scroll = true,
  children,
}: {
  sidebar: ReactNode;
  topBar: ReactNode;
  sidebarOpen?: boolean;
  scroll?: boolean;
  children: ReactNode;
}) {
  return (
    <SidebarProvider defaultOpen={sidebarOpen} className="h-dvh overflow-clip">
      {sidebar}
      <SidebarInset className="min-h-0 min-w-0 overflow-clip md:peer-data-[variant=inset]:shadow-[0_0_0_1px_var(--border),0_1px_3px_rgb(0_0_0/0.04)]">
        {topBar}
        <div
          data-slot="app-shell-body"
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            scroll ? "overflow-y-auto overscroll-contain" : "overflow-hidden",
          )}
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** The bar along the panel's top: the sidebar's toggle, where you are, and `end`. */
export function ShellTopBar({ children, end }: { children?: ReactNode; end?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger className="text-muted-foreground" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <nav className="flex min-w-0 items-center gap-1.5 text-sm">{children}</nav>
      {end && <div className="ml-auto flex shrink-0 items-center gap-2">{end}</div>}
    </header>
  );
}

export type TrailStep = {
  label: ReactNode;
  href?: string;
  mono?: boolean;
  /** Drawn before the label, such as a namespace's orb. */
  lead?: ReactNode;
};

type LinkLike = ComponentType<{ href: string; className?: string; children: ReactNode }>;

/**
 * Where you are, as a trail of links; the last step is the page. On a phone
 * only the last step shows.
 */
export function ShellTrail({ steps, link: Link }: { steps: TrailStep[]; link: LinkLike }) {
  return steps.map((step, i) => {
    const last = i === steps.length - 1;
    const hide = last ? "" : "max-sm:hidden";
    return (
      <Fragment key={i}>
        {i > 0 && <span className="text-faint max-sm:hidden">/</span>}
        {step.lead && <span className={cn("contents", hide)}>{step.lead}</span>}
        {step.href && !last ? (
          <Link
            href={step.href}
            className={cn(
              "truncate text-muted-foreground transition-colors hover:text-foreground",
              step.mono && "font-mono",
              hide,
            )}
          >
            {step.label}
          </Link>
        ) : (
          <span
            className={cn(
              "truncate",
              last ? "font-medium" : "text-muted-foreground",
              step.mono && "font-mono",
              hide,
            )}
          >
            {step.label}
          </span>
        )}
      </Fragment>
    );
  });
}

/** The top bar's search box; a button, since what it opens is the app's own. */
export function ShellSearch({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-8 w-56 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-sm:w-8 max-sm:justify-center max-sm:px-0"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="max-sm:hidden">{label}</span>
      <span className="ml-auto flex gap-0.5 max-sm:hidden">
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center border border-line-strong bg-background px-1 font-sans text-[10.5px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
