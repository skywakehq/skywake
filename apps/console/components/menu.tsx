"use client";

import { type FormEvent, type ReactElement, type ReactNode, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@skywake/ui/components/dialog";
import {
  DropdownContent,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from "@skywake/ui/components/dropdown";
import { Button, Input } from "./kit";

// Fluid Functionalism's dropdown, under the console's names. Rows are
// `MenuItem`s with a label, an icon and an index (for the gliding hover).
export { MenuItem } from "@skywake/ui/components/menu-item";
export const Menu = DropdownMenu;
export const MenuLabel = DropdownLabel;
export const MenuSeparator = DropdownSeparator;
export const MenuContent = DropdownContent;

/** The menu's button. With `asChild`, its one child is the button. */
export function MenuTrigger({
  asChild,
  children,
  className,
}: {
  asChild?: boolean;
  children: ReactElement | ReactNode;
  className?: string;
}) {
  if (asChild) return <DropdownTrigger render={children as ReactElement} />;
  return <DropdownTrigger className={className}>{children}</DropdownTrigger>;
}

/** A small dialog that asks for one value, like a branch name. */
export function Prompt({
  open,
  onOpenChange,
  title,
  description,
  label,
  initial = "",
  submit,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  label: string;
  initial?: string;
  submit: string;
  onSubmit: (value: string) => Promise<void> | void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("value")).trim();
    if (!value) return;
    setBusy(true);
    try {
      await onSubmit(value);
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (setError(""), onOpenChange(next))}>
      <DialogContent className="sm:max-w-[420px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className={description ? "text-sm" : "sr-only"}>
            {description ?? title}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handle} className="grid gap-4">
          <Input
            name="value"
            aria-label={label}
            placeholder={label}
            defaultValue={initial}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono"
          />
          {error && <p className="-mt-2 text-sm text-destructive">{error}</p>}
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
        </form>
      </DialogContent>
    </Dialog>
  );
}
