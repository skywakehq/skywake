import { Check, CircleDashed, GitMerge, Loader2, Lock, X } from "lucide-react";
import { cn } from "@skywake/ui/lib/utils";

export type Status =
  | "live"
  | "ready"
  | "conflict"
  | "checking"
  | "merged"
  | "rejected"
  | "ended"
  | "idle"
  | "protected";

const LOOK: Record<Status, { label: string; className: string; icon?: React.ReactNode }> = {
  live: { label: "live", className: "text-foreground" },
  ready: {
    label: "ready",
    className: "text-foreground",
    icon: <Check className="size-3" />,
  },
  conflict: {
    label: "conflict",
    className: "border-destructive/30 bg-destructive/5 text-destructive",
    icon: <X className="size-3" />,
  },
  checking: {
    label: "checking",
    className: "text-muted-foreground",
    icon: <Loader2 className="size-3 animate-spin" />,
  },
  merged: {
    label: "merged",
    className: "text-green",
    icon: <GitMerge className="size-3" />,
  },
  rejected: {
    label: "rejected",
    className: "text-destructive",
    icon: <X className="size-3" />,
  },
  ended: { label: "ended", className: "text-muted-foreground" },
  idle: {
    label: "idle",
    className: "text-muted-foreground",
    icon: <CircleDashed className="size-3" />,
  },
  protected: {
    label: "protected",
    className: "text-muted-foreground",
    icon: <Lock className="size-3" />,
  },
};

/** A state in words, with a mark beside it, so it never rests on colour alone. */
export function StatusPill({ status, className }: { status: Status; className?: string }) {
  const look = LOOK[status];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border bg-background px-1.5 text-xs font-medium",
        look.className,
        className,
      )}
    >
      {status === "live" ? <LiveDot /> : look.icon}
      {look.label}
    </span>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative grid size-2 place-items-center", className)}>
      <span className="absolute inset-0 animate-ping rounded-full bg-green/40 [animation-duration:2.4s]" />
      <span className="size-1.5 rounded-full bg-green" />
    </span>
  );
}
