import { defineMutator, defineMutators } from "@rocicorp/zero";
import { z } from "zod";

export const newEnvironment = z.object({ name: z.string() });

// What the browser shows at once, before the server answers. The server
// does the real work through skywake-api (see server-mutators.ts); Zero then
// replaces these guesses with the rows skywake-api wrote.
export const mutators = defineMutators({
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
