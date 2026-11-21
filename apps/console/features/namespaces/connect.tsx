"use client";

import { KeyRound } from "lucide-react";
import { Link } from "@/components/shell/router";
import { Button } from "@/components/kit";
import { MountLine } from "./disk-facts";

/** Shown until something is written: how to put the disk on a machine. */
export function Connect({ ns }: { ns: string }) {
  return (
    <div className="panel flex flex-wrap items-center gap-x-6 gap-y-4 p-6">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Mount it on a machine</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Give the agent a key, then run this where it works.
        </p>
      </div>
      <MountLine ns={ns} />
      <Button asChild variant="primary" size="default" leadingIcon={KeyRound}>
        <Link href="/settings#keys">Create a key</Link>
      </Button>
    </div>
  );
}
