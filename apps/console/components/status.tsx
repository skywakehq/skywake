import { Check, CircleDashed, GitMerge, Loader2, Lock, X } from "lucide-react";
import { cn } from "@skywake/ui/lib/utils";

export type Status =
  | "ready"
  | "conflict"
  | "checking"
  | "merged"
  | "rejected"
  | "idle"
  | "protected";

const LOOK: Record<Status, { label: string; className: string; icon?: React.ReactNode }> = {
  ready: {
    label: "Ready",
    className: "text-foreground",
    icon: <Check className="size-3" />,
  },
  conflict: {
    label: "Conflict",
    className: "bg-destructive/10 text-destructive",
    icon: <X className="size-3" />,
  },
  checking: {
    label: "Checking",
    className: "text-muted-foreground",
    icon: <Loader2 className="size-3 animate-spin" />,
  },
  merged: {
    label: "Merged",
    className: "text-green",
    icon: <GitMerge className="size-3" />,
  },
  rejected: {
    label: "Rejected",
    className: "text-destructive",
    icon: <X className="size-3" />,
  },
  idle: {
    label: "Idle",
    className: "text-muted-foreground",
    icon: <CircleDashed className="size-3" />,
  },
  protected: {
    label: "Protected",
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
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-foreground/[0.06] px-2 text-xs font-medium",
        look.className,
        className,
      )}
    >
      {look.icon}
      {look.label}
    </span>
  );
}
