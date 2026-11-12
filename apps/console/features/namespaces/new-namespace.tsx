"use client";

import { useZero } from "@rocicorp/zero/react";
import { type FormEvent, useState } from "react";
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
import { namespaceName } from "@/lib/names";
import { settled } from "@/lib/mutate";
import { nsPath } from "@/lib/paths";
import { city, useRegions } from "@/features/environments/regions";
import { defaultRegion, RegionPicker } from "@/features/environments/region-picker";
import { mutators } from "@/zero/mutators";
import { Button, Field, Input } from "@/components/kit";
import { navigate } from "@/components/shell/router";

/** Makes a filesystem (a namespace) in an environment and a region, then opens it. */
export function NewNamespace({
  env,
  open,
  onOpenChange,
}: {
  env: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const zero = useZero();
  const regions = useRegions();
  const [repo, setRepo] = useState("");
  const [picked, setPicked] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const region = picked ?? defaultRegion(regions);

  function close(next: boolean) {
    if (!next) {
      setRepo("");
      setPicked(undefined);
      setError("");
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = repo.trim();
    if (!value || !region) return;
    setBusy(true);
    try {
      const name = namespaceName(env, value);
      const result = zero.mutate(mutators.namespace.create({ name, region }));
      navigate(nsPath(name));
      await settled(result);
      toast.success(`Created ${value} in ${city(region)}`);
      close(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[440px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-base">New filesystem in {env}</DialogTitle>
          <DialogDescription className="text-sm">
            Its own branches and history. Agents fork it and merge back.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5">
          <Field label="Name">
            <Input
              value={repo}
              onChange={(event) => (setRepo(event.target.value), setError(""))}
              placeholder="app"
              autoFocus
              className="font-mono"
            />
          </Field>
          <div className="grid gap-1.5">
            <span className="text-sm text-muted-foreground">Region</span>
            <RegionPicker regions={regions} value={region} onChange={setPicked} />
            <p className="text-xs text-muted-foreground">
              It keeps all its data here. This can&apos;t change later.
            </p>
          </div>
          {error && <p className="-mt-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button size="default" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button size="default" variant="primary" disabled={busy || !repo.trim() || !region}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
