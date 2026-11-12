import type { indexes as routes } from "@skywake/contract";

import type { SearchIndex } from "../../auth/access.ts";
import { randomId } from "../../auth/keys.ts";
import type { Ctx } from "../../http/context.ts";
import { messageOf } from "../../http/errors.ts";
import * as indexes from "./queries.ts";

export async function start(
  c: Ctx,
  index: SearchIndex,
  branch: string | null,
  kind: routes.OperationKind,
  work: () => Promise<void>,
  requestedBy: string | null = null,
) {
  if (branch !== null) await index.store.schema(branch);
  const { db, log } = c.var.services;
  const row = { id: randomId("op_"), org: index.org, index: index.name, branch, kind, requestedBy };
  const operation = await indexes.startOperation(db, row);
  const requestId = c.get("requestId");
  void work()
    .then(
      () => null,
      (error: unknown) => {
        const message = messageOf(error);
        log({
          level: "error",
          msg: `index ${kind} failed`,
          request_id: requestId,
          index: index.name,
          branch,
          error: message,
        });
        return message;
      },
    )
    .then((error) => indexes.finishOperation(db, operation.id, error))
    .catch(() => {});
  return indexes.shownOperation(operation);
}
