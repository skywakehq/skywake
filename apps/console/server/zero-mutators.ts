import "server-only";

import { defineMutator, defineMutators } from "@rocicorp/zero";
import { skywakeJSON } from "@/server/api";
import type { Caller } from "@/server/caller";
import { mutators, newEnvironment } from "@/zero/mutators";

// The server side of each change: skywake-api does it, and writes the rows
// that Zero then sends to every browser.
export function serverMutators(caller: Caller) {
  return defineMutators(mutators, {
    environment: {
      create: defineMutator(newEnvironment, async ({ args }) => {
        const { status, data } = await skywakeJSON(caller, "/environments", "POST", args);
        if (status === 409) throw new Error(data?.error ?? "That environment exists");
      }),
    },
  });
}
