import type { Namespace } from "../../auth/access.ts";
import type { Db } from "../../db/client.ts";
import { badRequest } from "../../http/errors.ts";
import * as sessions from "./queries.ts";

export async function assertLiveSession(db: Db, ns: Namespace, session?: string) {
  if (session !== undefined && !(await sessions.isLive(db, ns.org, ns.name, session))) {
    throw badRequest(`session \`${session}\` has ended or does not exist`);
  }
}
