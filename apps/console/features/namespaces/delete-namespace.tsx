"use client";

import { useZero } from "@rocicorp/zero/react";
import { Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { DialogClose, DialogFooter } from "@skywake/ui/components/dialog";
import { Tooltip } from "@skywake/ui/components/tooltip";
import { envOf, nameInEnv } from "@/lib/names";
import { settled } from "@/lib/mutate";
import { envPath } from "@/lib/paths";
import { mutators } from "@/zero/mutators";
import { Button } from "@/components/kit";
import { navigate } from "@/components/shell/router";
import { FormDialog } from "@/features/settings/parts";

/** Deletes a disk, with its branches, history and search, after asking. */
export function DeleteNamespace({ ns }: { ns: string }) {
  const zero = useZero();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const name = nameInEnv(ns);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await settled(zero.mutate(mutators.namespace.remove({ name: ns })));
      toast.success(`Deleted ${name}`);
      setOpen(false);
      navigate(envPath(envOf(ns)));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    setBusy(false);
  }

  return (
    <>
      <Tooltip content="Delete disk">
        <Button size="icon" aria-label="Delete disk" onClick={() => setOpen(true)}>
          <Trash2 />
        </Button>
      </Tooltip>
      <FormDialog
        open={open}
        onOpenChange={(next) => (setOpen(next), setError(""))}
        title={`Delete ${name}?`}
        description="Its files, branches, history and search go with it. This can't be undone."
      >
        <form onSubmit={submit} className="grid gap-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button size="default" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button size="default" variant="primary" disabled={busy}>
              Delete disk
            </Button>
          </DialogFooter>
        </form>
      </FormDialog>
    </>
  );
}
