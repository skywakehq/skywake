"use client";

import { useZero } from "@rocicorp/zero/react";
import { toast } from "sonner";
import { settled } from "@/lib/mutate";
import { envPath } from "@/lib/paths";
import { mutators } from "@/zero/mutators";
import { Prompt } from "@/components/menu";
import { navigate } from "@/components/shell/router";

const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** Makes an environment, then opens it. It has no region; its filesystems and indexes pick one each. */
export function NewEnvironment({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const zero = useZero();
  return (
    <Prompt
      open={open}
      onOpenChange={onOpenChange}
      title="New environment"
      description="A group of filesystems and indexes, such as prod or staging. Keys can be limited to one."
      label="prod"
      submit="Create"
      onSubmit={async (name) => {
        if (!NAME.test(name)) throw new Error("Use letters, digits, '.', '_' and '-'.");
        await settled(zero.mutate(mutators.environment.create({ name })));
        navigate(envPath(name));
        toast.success(`Created ${name}`);
      }}
    />
  );
}
