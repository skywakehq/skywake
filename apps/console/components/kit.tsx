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
import { meshOf } from "@skywake/ui/lib/mesh";
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
        "inline-flex h-[18px] min-w-[18px] items-center justify-center border border-line-strong bg-background px-1 font-sans text-[10.5px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
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

/**
 * A console page: a small line naming where you are, a large title, then
 * the content. Every page uses it, so they line up.
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
          "mx-auto grid gap-8 px-8 pt-10 pb-16 max-sm:px-4 max-sm:pt-6",
          narrow ? "max-w-2xl" : "max-w-6xl",
        )}
      >
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-0">
            {eyebrow && (
              <div className="mb-2 text-micro font-medium tracking-wide text-faint uppercase">
                {eyebrow}
              </div>
            )}
            <h1 className="text-xl leading-7 font-semibold tracking-[-0.015em]">{title}</h1>
            {description && (
              <div className="mt-1.5 text-sm text-muted-foreground">{description}</div>
            )}
          </div>
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** A row of headline numbers, open on the page with a hairline under them. */
export function Stats({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-10 gap-y-6 border-b pb-8 md:auto-cols-fr md:grid-flow-col">
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
    <Box href={href!} className={cn("group relative flex flex-col gap-1")}>
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
        <Spark values={trend} className="absolute right-0 bottom-0 h-6 w-20 max-sm:hidden" />
      )}
    </Box>
  );
}

/** Small bars, one per day, the last one darker: how busy something has been. */
export function Spark({ values, className }: { values: number[]; className?: string }) {
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

/** A round mark for an agent or a person: their initial on a colour of their own. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  let hue = 0;
  for (const char of name) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return (
    <span
      title={name}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white uppercase ring-2 ring-background",
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(140deg, oklch(0.74 0.09 ${hue}), oklch(0.56 0.11 ${hue + 50}))`,
      }}
    >
      {name.replace(/^agents?[-/]/, "")[0]}
    </span>
  );
}

/** A filesystem's mark: a round gradient mesh made from its name. */
export function Orb({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-5 shrink-0 rounded-full", className)}
      style={{ background: meshOf(name) }}
    />
  );
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

/** A few avatars, overlapping, then "+n". */
export function Avatars({ names, max = 3 }: { names: string[]; max?: number }) {
  if (!names.length) return null;
  return (
    <span className="flex items-center -space-x-1.5">
      {names.slice(0, max).map((name) => (
        <Avatar key={name} name={name} className="size-5" />
      ))}
      {names.length > max && (
        <span className="grid size-5 place-items-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground ring-2 ring-background">
          +{names.length - max}
        </span>
      )}
    </span>
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
      <header className="flex h-10 items-center gap-2 border-b px-4">
        <h2 className="text-sm font-medium">{title}</h2>
        {count !== undefined && <span className="text-xs tabular-nums text-faint">{count}</span>}
        {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export function Header({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-5">
      <h1 className="min-w-0 truncate text-base font-medium">{title}</h1>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  );
}

/**
 * A list with nothing in it yet: its own columns drawn faintly, then what
 * goes here and how to add the first one.
 */
export function Empty({
  title,
  columns = [],
  children,
}: {
  title: string;
  columns?: string[];
  children?: ReactNode;
}) {
  const cells = Math.max(columns.length, 2);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <div aria-hidden className="select-none">
        {columns.length > 0 && (
          <div className="flex h-9 items-center gap-6 border-b border-border/60 px-5 text-xs text-muted-foreground">
            {columns.map((column, i) => (
              <span key={column} className={i === 0 ? "flex-1" : "w-16 text-right"}>
                {column}
              </span>
            ))}
          </div>
        )}
        {[0.9, 0.6, 0.3].map((opacity, row) => (
          <div
            key={row}
            style={{ opacity }}
            className="flex h-10 items-center gap-6 border-b border-border/60 px-5"
          >
            {Array.from({ length: cells }, (_, i) =>
              i === 0 ? (
                <span key={i} className="flex-1">
                  <span
                    className="rounded-sm block h-2 bg-foreground/[0.07]"
                    style={{ width: `${[38, 26, 32][row]}%` }}
                  />
                </span>
              ) : (
                <span key={i} className="flex w-16 justify-end">
                  <span className="rounded-sm block h-2 w-10 bg-foreground/[0.07]" />
                </span>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="max-w-md px-5 py-8">
        <p className="text-base font-medium">{title}</p>
        {children && <div className="mt-1.5 text-sm text-muted-foreground">{children}</div>}
      </div>
    </motion.div>
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
export function Count({ value, className }: { value: number; className?: string }) {
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
