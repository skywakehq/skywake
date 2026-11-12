import { sessions as routes } from "@skywake/contract";

import { note } from "../../audit/note.ts";
import { randomId } from "../../auth/keys.ts";
import type { Feature } from "../../http/context.ts";
import { errorFields, notFound } from "../../http/errors.ts";
import { clamp } from "../../http/page.ts";
import { changeable, readable } from "../../http/request.ts";
import * as branches from "../branches/queries.ts";
import * as sessions from "./queries.ts";
import { assertLiveSession } from "./rules.ts";

const lifetime = (seconds?: number) => clamp(seconds, 60, 1, 3600);

const trimmed = (path: string) => path.replace(/^\/+|\/+$/g, "");

export const sessionsFeature: Feature = {
  register(api) {
    api.openapi(routes.listSessions, async (c) => {
      const ns = await readable(c, c.req.valid("param").namespace);
      const live = await sessions.live(c.var.services.db, ns.org, ns.name, c.req.valid("query"));
      // Readers of a public namespace from outside see what runs, not who runs it.
      const insider = (await c.var.caller())?.org === ns.org;
      return c.json(insider ? live : live.map((session) => ({ ...session, actor: null })), 200);
    });

    api.openapi(routes.startSession, async (c) => {
      const { caller, ns } = await changeable(c, c.req.valid("param").namespace, "write");
      const { label = "", seconds } = c.req.valid("json");
      const session = await sessions.create(c.var.services.db, {
        id: randomId("ses_"),
        org: ns.org,
        namespace: ns.name,
        label,
        actor: caller.actor,
        seconds: lifetime(seconds),
      });
      note(c, { details: { session: session.id } });
      return c.json(session, 201);
    });

    api.openapi(routes.renewSession, async (c) => {
      const { namespace, id } = c.req.valid("param");
      const { ns } = await changeable(c, namespace, "write");
      const session = await sessions.renew(
        c.var.services.db,
        ns.org,
        ns.name,
        id,
        lifetime(c.req.valid("json").seconds),
      );
      if (!session) throw notFound(`live session \`${id}\``);
      return c.json(session, 200);
    });

    api.openapi(routes.endSession, async (c) => {
      const { namespace, id } = c.req.valid("param");
      const { ns } = await changeable(c, namespace, "write");
      if (!(await sessions.end(c.var.services.db, ns.org, ns.name, id)))
        throw notFound(`session \`${id}\``);
      return c.body(null, 204);
    });

    api.openapi(routes.listClaims, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const ns = await readable(c, namespace);
      const { db } = c.var.services;
      return c.json(await sessions.claims(db, ns.org, ns.name, branch, c.req.valid("query")), 200);
    });

    api.openapi(routes.claimPath, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { path = "", session } = c.req.valid("json");
      const { ns } = await changeable(c, namespace, "write");
      const { db } = c.var.services;
      await assertLiveSession(db, ns, session);
      if (!(await branches.find(db, { org: ns.org, namespace: ns.name, name: branch }))) {
        throw notFound(`branch \`${branch}\``);
      }
      const result = await sessions.claim(db, {
        org: ns.org,
        namespace: ns.name,
        branch,
        path: trimmed(path),
        session,
      });
      if (result.taken) return c.json(result.claim, 200);
      const held = errorFields(c, 409, `\`${result.claim.path}\` is claimed by another session`);
      return c.json({ ...result.claim, ...held }, 409);
    });

    api.openapi(routes.releaseClaim, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { path = "", session } = c.req.valid("query");
      const { ns } = await changeable(c, namespace, "write");
      const ref = { org: ns.org, namespace: ns.name, branch, path: trimmed(path), session };
      if (!(await sessions.release(c.var.services.db, ref)))
        throw notFound(`claim on \`${ref.path}\``);
      return c.body(null, 204);
    });
  },
};
