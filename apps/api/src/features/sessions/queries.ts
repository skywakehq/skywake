import { sql } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { onceEvery } from "../../db/throttle.ts";
import { pageSize, type Page } from "../../http/page.ts";

type SessionRow = {
  id: string;
  label: string;
  actor: string;
  expires_in: number;
  created: string;
};

type ClaimRow = {
  path: string;
  session: string;
  label: string;
};

const shown = (row: SessionRow) => ({ ...row, created: new Date(row.created).toISOString() });

const SESSION = sql`id, label, actor, extract(epoch FROM expires - now())::float8 AS expires_in, created`;

export interface NewSession {
  id: string;
  org: string;
  namespace: string;
  label: string;
  actor: string;
  seconds: number;
}

const clearDue = onceEvery(60_000);

export async function create(db: Db, session: NewSession) {
  if (clearDue()) {
    await db.execute(sql`DELETE FROM api.sessions WHERE expires < now() - interval '1 day'`);
  }
  const { rows } = await db.execute<SessionRow>(sql`
    INSERT INTO api.sessions (id, org, namespace, label, actor, expires)
    VALUES (${session.id}, ${session.org}, ${session.namespace}, ${session.label}, ${session.actor},
            now() + make_interval(secs => ${session.seconds}))
    RETURNING ${SESSION}`);
  return shown(rows[0]!);
}

export async function renew(db: Db, org: string, namespace: string, id: string, seconds: number) {
  const { rows } = await db.execute<SessionRow>(sql`
    UPDATE api.sessions SET expires = now() + make_interval(secs => ${seconds})
    WHERE org = ${org} AND namespace = ${namespace} AND id = ${id} AND expires > now()
    RETURNING ${SESSION}`);
  return rows[0] ? shown(rows[0]) : null;
}

export async function end(db: Db, org: string, namespace: string, id: string) {
  return db.transaction(async (tx) => {
    const { rowCount } = await tx.execute(sql`
      UPDATE api.sessions SET expires = now()
      WHERE org = ${org} AND namespace = ${namespace} AND id = ${id} AND expires > now()`);
    await tx.execute(sql`
      DELETE FROM api.claims WHERE org = ${org} AND namespace = ${namespace} AND session = ${id}`);
    return rowCount === 1;
  });
}

export async function live(db: Db, org: string, namespace: string, { limit, after }: Page) {
  const { rows } = await db.execute<SessionRow>(sql`
    SELECT ${SESSION} FROM api.sessions
    WHERE org = ${org} AND namespace = ${namespace} AND expires > now()
      AND (${after ?? null}::text IS NULL
           OR (created, id) > (SELECT created, id FROM api.sessions WHERE id = ${after ?? null}))
    ORDER BY created, id
    LIMIT ${pageSize(limit)}`);
  return rows.map(shown);
}

export async function isLive(db: Db, org: string, namespace: string, id: string) {
  const { rows } = await db.execute(sql`
    SELECT 1 FROM api.sessions
    WHERE org = ${org} AND namespace = ${namespace} AND id = ${id} AND expires > now()`);
  return rows.length > 0;
}

export interface ClaimRef {
  org: string;
  namespace: string;
  branch: string;
  path: string;
  session: string;
}

export async function claim(db: Db, ref: ClaimRef): Promise<{ taken: boolean; claim: ClaimRow }> {
  const { org, namespace, branch, path, session } = ref;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`claims/${org}/${namespace}/${branch}`}))`,
    );
    const held = await tx.execute<ClaimRow>(sql`
      SELECT c.path, c.session, s.label FROM api.claims c JOIN api.sessions s ON s.id = c.session
      WHERE c.org = ${org} AND c.namespace = ${namespace} AND c.branch = ${branch} AND s.expires > now()
        AND c.session <> ${session}
        AND (c.path = '' OR ${path} = '' OR c.path = ${path}
             OR starts_with(${path}, c.path || '/') OR starts_with(c.path, ${path} || '/'))
      LIMIT 1`);
    if (held.rows[0]) return { taken: false, claim: held.rows[0] };
    const { rows } = await tx.execute<ClaimRow>(sql`
      WITH taken AS (
        INSERT INTO api.claims (org, namespace, branch, path, session)
        VALUES (${org}, ${namespace}, ${branch}, ${path}, ${session})
        ON CONFLICT (org, namespace, branch, path) DO UPDATE SET session = EXCLUDED.session
        RETURNING path, session)
      SELECT taken.path, taken.session, s.label FROM taken JOIN api.sessions s ON s.id = taken.session`);
    return { taken: true, claim: rows[0]! };
  });
}

export async function release(db: Db, ref: ClaimRef) {
  const { rowCount } = await db.execute(sql`
    DELETE FROM api.claims
    WHERE org = ${ref.org} AND namespace = ${ref.namespace} AND branch = ${ref.branch}
      AND path = ${ref.path} AND session = ${ref.session}`);
  return rowCount === 1;
}

export async function claims(
  db: Db,
  org: string,
  namespace: string,
  branch: string,
  { limit, after }: Page,
) {
  const { rows } = await db.execute<ClaimRow>(sql`
    SELECT c.path, c.session, s.label FROM api.claims c JOIN api.sessions s ON s.id = c.session
    WHERE c.org = ${org} AND c.namespace = ${namespace} AND c.branch = ${branch} AND s.expires > now()
      AND (${after ?? null}::text IS NULL OR c.path > ${after ?? null})
    ORDER BY c.path
    LIMIT ${pageSize(limit)}`);
  return rows;
}
