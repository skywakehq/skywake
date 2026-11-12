import { z } from "../schemas.ts";
import { REPLICAS_MAX } from "./limits.ts";

export const Pinned = z
  .object({
    replicas: z
      .number()
      .int()
      .min(1)
      .max(REPLICAS_MAX)
      .openapi({ description: "Servers that keep the index open and on their disks." }),
  })
  .openapi("IndexPinned", {
    description:
      "Reserved servers for the index, billed per GB-hour for each replica instead of per " +
      "query. Queries go to the least busy replica. A copy is not pinned.",
  });
export type Pinned = z.output<typeof Pinned>;

export const PinnedReplica = z
  .object({
    server: z.string().openapi({ description: "The API server holding the replica." }),
    warm: z.boolean().openapi({
      description: "Whether every object of the current version is on the server's disk.",
    }),
    in_flight: z.number().int().openapi({ description: "Queries it is answering now." }),
  })
  .openapi("PinnedReplica");

export const Pinning = z
  .object({
    replicas: z.array(PinnedReplica).openapi({
      description: "The replicas placed; fewer than asked while fewer servers run.",
    }),
  })
  .openapi("IndexPinning");
