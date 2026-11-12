import { defineMutator, defineMutators } from "@rocicorp/zero";
import { z } from "zod";

export const fork = z.object({
  ns: z.string(),
  name: z.string(),
  // Without it, the branch starts empty.
  from: z.string().optional(),
  at: z.string().optional(),
});
export const named = z.object({ ns: z.string(), name: z.string() });
export const protect = named.extend({ protected: z.boolean() });
export const merge = z.object({ ns: z.string(), into: z.string(), from: z.string() });
export const newNamespace = z.object({ name: z.string(), region: z.string() });
export const newEnvironment = z.object({ name: z.string() });

// What the browser shows at once, before the server answers. The server
// does the real work through skywake-api (see server-mutators.ts); Zero then
// replaces these guesses with the rows skywake-api wrote.
export const mutators = defineMutators({
  branch: {
    fork: defineMutator(fork, async ({ tx, args, ctx }) => {
      const now = Date.now();
      await tx.mutate.branch.insert({
        org: ctx.org,
        namespace: args.ns,
        name: args.name,
        forkedFrom: args.from ?? null,
        protected: false,
        head: args.at ?? null,
        created: now,
        updated: now,
      });
    }),
    remove: defineMutator(named, async ({ tx, args, ctx }) => {
      await tx.mutate.branch.delete({ org: ctx.org, namespace: args.ns, name: args.name });
    }),
    protect: defineMutator(protect, async ({ tx, args, ctx }) => {
      await tx.mutate.branch.update({
        org: ctx.org,
        namespace: args.ns,
        name: args.name,
        protected: args.protected,
      });
    }),
    // A merge needs the file data, so the browser can't guess its result.
    merge: defineMutator(merge, async () => {}),
  },
  namespace: {
    create: defineMutator(newNamespace, async ({ tx, args, ctx }) => {
      await tx.mutate.namespace.insert({
        org: ctx.org,
        name: args.name,
        region: args.region,
        created: Date.now(),
      });
    }),
  },
  environment: {
    create: defineMutator(newEnvironment, async ({ tx, args, ctx }) => {
      await tx.mutate.environment.insert({
        org: ctx.org,
        name: args.name,
        created: Date.now(),
      });
    }),
  },
});
