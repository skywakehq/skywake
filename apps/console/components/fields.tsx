"use client";

import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cx } from "@/components/kit";

const FIELD =
  "h-8 rounded-lg bg-muted/60 px-2.5 text-sm outline-none transition-colors hover:bg-muted focus:bg-muted";

/** A native select, with our own chevron so it gets the same padding as the fields. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <span className={cx("relative inline-flex", className)}>
      <select className={cx(FIELD, "w-full appearance-none pr-8")} {...props} />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

export function TextField({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(FIELD, "min-w-0", className)} {...props} />;
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      spellCheck={false}
      className={cx(
        "min-h-24 w-full resize-y rounded-lg bg-muted/60 p-3 font-mono text-xs leading-5 outline-none transition-colors focus:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

/** A small label over a field or a number. */
export function Label({ children, className }: { children: string; className?: string }) {
  return <span className={cx("text-xs text-muted-foreground", className)}>{children}</span>;
}
