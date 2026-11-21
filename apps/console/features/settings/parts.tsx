"use client";

import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@skywake/ui/components/dialog";
import { Tooltip } from "@skywake/ui/components/tooltip";
import { Button, cx } from "@/components/kit";

/** Runs an action and shows its error, if any, as a toast. */
export async function act(action: () => Promise<unknown>) {
  try {
    const result = (await action()) as { error?: { message?: string } } | undefined;
    if (result?.error) throw new Error(result.error.message ?? "Something went wrong");
    return true;
  } catch (failure) {
    toast.error(failure instanceof Error ? failure.message : String(failure));
    return false;
  }
}

export function copy(text: string, what: string) {
  navigator.clipboard.writeText(text);
  toast.success(`${what} copied`);
}

/** The top of a settings page: what it is, and its one action. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div>
      <div className="flex h-9 items-center justify-between gap-4">
        <h2 className="truncate text-[20px] font-medium tracking-[-0.025em]">{title}</h2>
        {action}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("panel overflow-hidden p-1.5", className)}>{children}</div>;
}

/** A titled part of a page: heading and action on one line, then a list. */
export function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="grid scroll-mt-8 gap-3">
      <div>
        <div className="flex h-8 items-center justify-between gap-4">
          <h3 className="truncate text-[15px] font-medium tracking-[-0.01em]">{title}</h3>
          {action}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Panel>{children}</Panel>
    </section>
  );
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "flex min-h-15 items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-sm transition-colors hover:bg-hover",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Lines({ title, detail }: { title: ReactNode; detail?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 truncate font-medium">{title}</div>
      {detail && <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{detail}</div>}
    </div>
  );
}

export function Glyph({ icon: Icon, tone }: { icon: typeof Plus; tone?: "signal" | "green" }) {
  return (
    <span
      className={cx(
        "grid size-9 shrink-0 place-items-center rounded-xl",
        tone === "signal"
          ? "bg-signal/12 text-signal"
          : tone === "green"
            ? "bg-green/12 text-green"
            : "bg-tint text-muted-foreground",
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

/** A small icon button for removing something, named by its tooltip. */
export function Remove({
  label,
  onClick,
  icon = Trash2,
}: {
  label: string;
  onClick: () => void;
  icon?: typeof Plus;
}) {
  const Icon = icon;
  return (
    <Tooltip content={label}>
      <Button
        variant="plain"
        size="icon-sm"
        aria-label={label}
        onClick={onClick}
        className="text-muted-foreground hover:text-destructive"
      >
        <Icon />
      </Button>
    </Tooltip>
  );
}

export function Tag({ children, tone }: { children: ReactNode; tone?: "green" }) {
  return (
    <span
      className={cx(
        "rounded-md px-1.5 py-px text-[11px] font-medium",
        tone === "green" ? "bg-green/12 text-green" : "bg-tint text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Nothing in a list yet: a line and, if there is one, the way to add the first. */
export function Nothing({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="text-sm">{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function Actions({ submit, busy }: { submit: string; busy: boolean }) {
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button size="default" type="button">
          Cancel
        </Button>
      </DialogClose>
      <Button size="default" variant="primary" disabled={busy}>
        {submit}
      </Button>
    </DialogFooter>
  );
}
