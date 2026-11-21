"use client";

import { ArrowUpRight } from "lucide-react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import {
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button as UIButton } from "@skywake/ui/components/button";
import { Tabs, TabsItem } from "@skywake/ui/components/tabs";
import type { IconComponent } from "@skywake/ui/lib/icon-context";
import { Input } from "@skywake/ui/components/input";
import { Skeleton } from "@skywake/ui/components/skeleton";
import { FolderIcon } from "@skywake/ui/components/folder-icon";
import { cn } from "@skywake/ui/lib/utils";
import { Link } from "@/components/shell/router";

export { Input };
export const cx = cn;

// The console's names for the Fluid Functionalism button variants.
const VARIANTS = {
  primary: "primary",
  ghost: "tertiary",
  danger: "destructive",
  plain: "ghost",
} as const;

type ButtonProps = Omit<ComponentProps<typeof UIButton>, "variant"> & {
  variant?: keyof typeof VARIANTS;
};

export function Button({ variant = "ghost", size = "sm", ...props }: ButtonProps) {
  return <UIButton variant={VARIANTS[variant]} size={size} {...props} />;
}

/** A few choices in a row, with a pill that slides to the chosen one. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: IconComponent }[];
  onChange: (value: T) => void;
}) {
  return (
    <Tabs
      size="compact"
      selectedIndex={options.findIndex((option) => option.value === value)}
      onSelect={(index) => onChange(options[index]!.value)}
    >
      {options.map((option, index) => (
        <TabsItem key={option.value} index={index} label={option.label} icon={option.icon} />
      ))}
    </Tabs>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-tint px-1 font-sans text-[10.5px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A small square checkbox. `partly` draws a dash: some, not all. */
export function Checkbox({
  on,
  partly,
  onClick,
  label,
}: {
  on: boolean;
  partly?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={partly ? "mixed" : on}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cx(
        "grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors",
        on || partly
          ? "border-foreground bg-foreground text-background"
          : "border-line-strong bg-background hover:border-foreground/40",
      )}
    >
      {on && (
        <svg
          viewBox="0 0 12 12"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M2.5 6.2 5 8.5l4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {partly && !on && <span className="h-0.5 w-2 bg-current" />}
    </button>
  );
}

/** A short commit hash, in the mono face. */
export function Hash({ value, className }: { value?: string | null; className?: string }) {
  if (!value) return null;
  return (
    <span className={cn("font-mono text-xs text-muted-foreground", className)}>
      {value.slice(0, 8)}
    </span>
  );
}

/** The small label above a heading, marked with a small folder. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground">
      <FolderIcon className="h-3.5 w-auto shrink-0 -rotate-6" />
      {children}
    </div>
  );
}

/**
 * A console page: a label and a title on the left, a line and the actions on
 * the right, then the content. Every page uses it, so they line up.
 */
export function Page({
  eyebrow,
  title,
  description,
  actions,
  narrow,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div
        className={cn(
          "mx-auto grid gap-10 px-8 pt-10 pb-16 max-sm:px-4 max-sm:pt-6",
          narrow ? "max-w-2xl" : "max-w-6xl",
        )}
      >
        <div
          className={cn(
            "grid gap-5",
            !narrow && "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-end lg:gap-12",
          )}
        >
          <div className="min-w-0">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            <h1 className="text-[28px] leading-8 font-medium tracking-[-0.03em]">{title}</h1>
          </div>
          {(description || actions) && (
            <div className="grid gap-4">
              {description && (
                <div className="max-w-[46ch] text-sm leading-6 text-muted-foreground">
                  {description}
                </div>
              )}
              {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export type Tab = { href: string; label: string; active: boolean };

/** A row of tabs as pills, with a fill that slides to the open one. `tools` sit at its end. */
export function TabNav({ id, tabs, tools }: { id: string; tabs: Tab[]; tools?: ReactNode }) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "relative isolate flex h-8 shrink-0 items-center rounded-full px-3.5 text-sm transition-colors",
            tab.active
              ? "font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.active && (
            <motion.span
              layoutId={`tabs-${id}`}
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
              className="absolute inset-0 -z-10 rounded-full bg-active"
            />
          )}
          {tab.label}
        </Link>
      ))}
      {tools && <div className="ml-auto flex items-center gap-2">{tools}</div>}
    </nav>
  );
}

/** A row of headline numbers, each on its own soft tray. */
export function Stats({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:auto-cols-fr md:grid-flow-col">
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
  trend,
  alert,
  href,
}: {
  href?: string;
  label: string;
  value: number;
  note?: ReactNode;
  /** Counts per day, oldest first, drawn under the number. */
  trend?: number[];
  /** Draw a non-zero value in the signal colour: it needs someone. */
  alert?: boolean;
}) {
  const Box = href ? Link : "div";
  return (
    <Box href={href!} className="group panel relative flex flex-col gap-1 p-5">
      <span
        className={cn(
          "flex items-center gap-1 text-xs text-muted-foreground",
          href && "transition-colors group-hover:text-foreground",
        )}
      >
        {label}
        {href && (
          <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </span>
      <Count
        value={value}
        className={cn(
          "text-[22px] leading-8 font-medium tracking-[-0.02em]",
          alert && value > 0 && "text-signal",
        )}
      />
      {note && <span className="text-xs text-faint">{note}</span>}
      {trend && (
        <Spark values={trend} className="absolute right-5 bottom-5 h-6 w-20 max-sm:hidden" />
      )}
    </Box>
  );
}

/** Small bars, one per day, the last one darker: how busy something has been. */
function Spark({ values, className }: { values: number[]; className?: string }) {
  const most = Math.max(1, ...values);
  return (
    <div className={cn("flex items-end gap-[3px]", className)} aria-hidden>
      {values.map((value, i) => (
        <span
          key={i}
          className={cn(
            "flex-1 bg-foreground",
            i === values.length - 1 ? "opacity-85" : value ? "opacity-25" : "opacity-10",
          )}
          style={{ height: value ? `${Math.max(8, (value / most) * 100)}%` : "2px" }}
        />
      ))}
    </div>
  );
}

/** How many of `times` fell on each of the last `days` days, oldest first. */
export function perDay(times: number[], days: number, current = Date.now()) {
  const today = new Date(current);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() - (days - 1) * 86_400_000;
  const counts = Array<number>(days).fill(0);
  for (const time of times) {
    const day = Math.floor((time - start) / 86_400_000);
    if (day >= 0 && day < days) counts[day]++;
  }
  return counts;
}

/** A person's or a key's mark: its initial. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      title={name}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-[24%] bg-tint text-[10px] font-semibold text-foreground uppercase",
        className,
      )}
    >
      {name[0]}
    </span>
  );
}

/** A disk's mark: the yellow folder. */
export function DiskMark({ className }: { className?: string }) {
  return <FolderIcon className={cn("h-5 w-auto shrink-0", className)} />;
}


type Box = { x: number; y: number; width: number; height: number };

/**
 * One hover fill for a whole list, which glides from row to row instead of
 * blinking on each one (the Fluid Functionalism hover). Mark rows with
 * `data-glide`. Entering the list, or leaving a gap, fades the fill in fresh.
 */
export function Glide({
  children,
  className,
  fill,
}: {
  children: ReactNode;
  className?: string;
  fill?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLElement | null>(null);
  const [rect, setRect] = useState<Box | null>(null);
  const [session, setSession] = useState(0);
  const still = useReducedMotion();

  function show(next: HTMLElement | null) {
    if (next && !row.current) setSession((n) => n + 1);
    row.current = next;
    if (!next || !box.current) return setRect(null);
    const outer = box.current.getBoundingClientRect();
    const inner = next.getBoundingClientRect();
    setRect({
      x: inner.left - outer.left,
      y: inner.top - outer.top,
      width: inner.width,
      height: inner.height,
    });
  }

  function onMouseMove(event: MouseEvent) {
    const next = (event.target as HTMLElement).closest<HTMLElement>("[data-glide]");
    const inside = next && box.current?.contains(next) ? next : null;
    if (inside !== row.current) show(inside);
  }

  return (
    <div
      ref={box}
      className={cn("relative isolate", className)}
      onMouseMove={onMouseMove}
      onMouseLeave={() => show(null)}
      onScrollCapture={() => row.current && show(row.current)}
    >
      <AnimatePresence>
        {rect && (
          <motion.div
            key={session}
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-0 left-0 -z-10 border-0 bg-hover",
              fill,
            )}
            initial={{ opacity: 0, ...rect }}
            animate={{ opacity: 1, ...rect }}
            exit={{ opacity: 0, transition: { duration: 0.06 } }}
            transition={{
              ...(still ? { duration: 0 } : { type: "spring", duration: 0.08, bounce: 0 }),
              opacity: { duration: 0.08 },
            }}
          />
        )}
      </AnimatePresence>
      {children}
    </div>
  );
}

/**
 * A titled section with no box: a header line, then its rows. Rows keep their
 * own padding, so the section bleeds out by that much and the text lines up
 * with the page title.
 */
export function Panel({
  title,
  count,
  action,
  children,
  className,
}: {
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("-mx-4", className)}>
      <header className="flex h-10 items-center gap-2 px-4">
        <h2 className="text-sm font-medium">{title}</h2>
        {count !== undefined && <span className="text-xs tabular-nums text-faint">{count}</span>}
        {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
      </header>
      {children}
    </section>
  );
}

/** A list with nothing in it yet: a folder, what goes here, and how to add the first one. */
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel grid justify-items-start gap-5 p-8 sm:p-10">
      <FolderIcon className="h-12 w-auto" />
      <div className="max-w-md">
        <p className="text-lg font-medium tracking-[-0.015em]">{title}</p>
        {children && <div className="mt-1.5 text-sm text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** Quiet rows that hold the place of a list while Zero syncs. */
export function Rows({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-px", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-3 px-5">
          <Skeleton className="h-3" style={{ width: `${40 - ((i * 7) % 20)}%` }} />
          <Skeleton className="ml-auto h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

/** A number that rolls to its new value instead of jumping. */
function Count({ value, className }: { value: number; className?: string }) {
  const motionValue = useMotionValue(value);
  const shown = useTransform(motionValue, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    const controls = animate(motionValue, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [motionValue, value]);
  return <motion.span className={cn("tabular-nums", className)}>{shown}</motion.span>;
}

// One clock for every "3m ago" on the page, so they tick together.
let now = Date.now();
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  setInterval(() => {
    now = Date.now();
    listeners.forEach((listener) => listener());
  }, 5_000);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useNow() {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
}

export function ago(time: number, current: number) {
  const seconds = Math.max(0, Math.round((current - time) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Ago({ time, className }: { time: number; className?: string }) {
  const current = useNow();
  return (
    <time
      dateTime={new Date(time).toISOString()}
      title={new Date(time).toLocaleString()}
      className={cn("shrink-0 tabular-nums text-xs text-faint", className)}
    >
      {ago(time, current)}
    </time>
  );
}

export const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : /(s|sh|ch|x)$/.test(word) ? "es" : "s"}`;
