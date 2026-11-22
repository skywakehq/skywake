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
import { RegionGlobe } from "@skywake/ui/components/globe";
import { namespaceName } from "@/lib/names";
import { settled } from "@/lib/mutate";
import { nsPath } from "@/lib/paths";
import { area, city, useRegions } from "@/features/environments/regions";
import { defaultRegion, RegionPicker } from "@/features/environments/region-picker";
import { connectAgent } from "@/features/agents/connect-agent";
import { mutators } from "@/zero/mutators";
import { Button, Field, Input } from "@/components/kit";
import { navigate } from "@/components/shell/router";

/** Makes a disk (a namespace) in an environment and a region, then opens it. */
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
      await settled(zero.mutate(mutators.namespace.create({ name, region })));
      toast.success(`Created ${value} in ${city(region)}`);
      close(false);
      connectAgent(name);
      navigate(nsPath(name));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-[780px]"
        showCloseButton={false}
      >
        <div className="grid sm:grid-cols-[1fr_300px]">
          <form onSubmit={submit} className="grid gap-5 p-7">
            <DialogHeader>
              <DialogTitle className="text-base">New disk in {env}</DialogTitle>
              <DialogDescription className="text-sm">
                Its own branches and history. Agents fork it and merge back.
              </DialogDescription>
            </DialogHeader>
            <Field label="Name">
              <Input
                value={repo}
                onChange={(event) => (setRepo(event.target.value), setError(""))}
                placeholder="app"
                autoFocus
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
            <DialogFooter className="mt-auto pt-2">
              <DialogClose asChild>
                <Button size="default" type="button">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                size="default"
                variant="primary"
                disabled={busy || !repo.trim() || !region}
              >
                Create
              </Button>
            </DialogFooter>
          </form>
          <div className="hidden flex-col items-center justify-center gap-6 border-l bg-muted/20 px-10 py-8 sm:flex">
            <RegionGlobe
              regions={regions.map((r) => r.name)}
              focus={region}
              className="w-full max-w-[220px]"
            />
            <div className="h-9 text-center">
              {region && (
                <>
                  <p className="text-sm font-medium">{city(region)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[area(region), region].filter(Boolean).join(" · ")}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
