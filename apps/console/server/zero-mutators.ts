import "server-only";

import { defineMutator, defineMutators } from "@rocicorp/zero";
import { skywakeJSON, part } from "@/server/api";
import type { Caller } from "@/server/caller";
import {
  fork,
  merge,
  mutators,
  named,
  newEnvironment,
  newNamespace,
  protect,
} from "@/zero/mutators";

// The server side of each change: skywake-api does it, and writes the rows
// that Zero then sends to every browser.
export function serverMutators(caller: Caller) {
  const branches = (ns: string) => `/namespaces/${part(ns)}/branches`;
  return defineMutators(mutators, {
    branch: {
      fork: defineMutator(fork, async ({ args }) => {
        const body = { name: args.name, from: args.from, at: args.at };
        await skywakeJSON(caller, branches(args.ns), "POST", body);
      }),
      remove: defineMutator(named, async ({ args }) => {
        await skywakeJSON(caller, `${branches(args.ns)}/${part(args.name)}`, "DELETE");
      }),
      protect: defineMutator(protect, async ({ args }) => {
        const path = `${branches(args.ns)}/${part(args.name)}`;
        await skywakeJSON(caller, path, "PATCH", { protected: args.protected });
      }),
      merge: defineMutator(merge, async ({ args }) => {
        const body = { into: args.into, from: args.from };
        const { data } = await skywakeJSON(
          caller,
          `/namespaces/${part(args.ns)}/merges`,
          "POST",
          body,
        );
        if (data?.conflicts?.length) throw new Error(`Conflicts in ${data.conflicts.join(", ")}`);
      }),
    },
    namespace: {
      create: defineMutator(newNamespace, async ({ args }) => {
        await skywakeJSON(caller, "/namespaces", "POST", args);
      }),
    },
    environment: {
      create: defineMutator(newEnvironment, async ({ args }) => {
        const { status, data } = await skywakeJSON(caller, "/environments", "POST", args);
        if (status === 409) throw new Error(data?.error ?? "That environment exists");
      }),
    },
  });
}
