"use client";

import type { ComponentProps } from "react";
import { cx } from "@/components/kit";

// Small form parts for the index pages, flat like the rest of the console:
// a soft fill, no border box, no shadow.

const FIELD =
  "h-8 bg-muted/60 px-2.5 text-sm outline-none transition-colors hover:bg-muted focus:bg-muted";

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(FIELD, "pr-7", className)} {...props} />;
}

export function TextField({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(FIELD, "min-w-0", className)} {...props} />;
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      spellCheck={false}
      className={cx(
        "min-h-24 w-full resize-y bg-muted/60 p-3 font-mono text-xs leading-5 outline-none transition-colors focus:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

/** A small uppercase mono label over a field or a number. */
export function Label({ children, className }: { children: string; className?: string }) {
  return (
    <span className={cx("font-mono text-micro tracking-wide text-faint uppercase", className)}>
      {children}
    </span>
  );
}
