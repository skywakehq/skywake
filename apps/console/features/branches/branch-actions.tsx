"use client";

import { useZero } from "@rocicorp/zero/react";
import { useState } from "react";
import { settled } from "@/lib/mutate";
import { branchPath } from "@/lib/paths";
import { mutators } from "@/zero/mutators";
import { Prompt } from "@/components/menu";
import { navigate } from "@/components/shell/router";

/** The dialog that forks a branch, at its head or at an older commit. */
export function ForkDialog({
  ns,
  from,
  at,
  open,
  onOpenChange,
}: {
  ns: string;
  from: string;
  at?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const zero = useZero();
  return (
    <Prompt
      open={open}
      onOpenChange={onOpenChange}
      title={at ? "Fork from this commit" : `Fork ${from}`}
      description={
        at ? (
          <>
            A new branch that starts at <span className="font-mono">{at.slice(0, 8)}</span>, as{" "}
            <span className="font-mono">{from}</span> was then.
          </>
        ) : (
          "A new branch with the same files. Nothing is copied."
        )
      }
      label="Branch name"
      initial={`${from}-retry`}
      submit="Fork"
      onSubmit={async (name) => {
        const result = zero.mutate(mutators.branch.fork({ ns, name, from, at }));
        navigate(branchPath(ns, name));
        await settled(result);
      }}
    />
  );
}

export function useBranchActions(ns: string) {
  const zero = useZero();
  return {
    create: (name: string) => settled(zero.mutate(mutators.branch.fork({ ns, name }))),
    protect: (name: string, value: boolean) =>
      settled(zero.mutate(mutators.branch.protect({ ns, name, protected: value }))),
    remove: (name: string) => settled(zero.mutate(mutators.branch.remove({ ns, name }))),
  };
}

export function useForkDialog() {
  const [fork, setFork] = useState<{ from: string; at?: string } | null>(null);
  return {
    fork,
    openFork: (from: string, at?: string) => setFork({ from, at }),
    closeFork: () => setFork(null),
  };
}
