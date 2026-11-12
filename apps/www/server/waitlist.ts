import { emailOn, send, waitlist } from "@skywake/email";
import { Pool } from "pg";

const SELF_HOST_URL = new URL(
  "/docs/self-hosting/docker-compose",
  process.env.SITE_URL ?? "https://skywake.dev",
).href;

let pool: Pool | undefined;
let ready: Promise<unknown> | undefined;

function store() {
  const url = process.env.WAITLIST_DATABASE;
  if (!url) return undefined;
  pool ??= new Pool({ connectionString: url, max: 2 });
  ready ??= pool
    .query(
      `create schema if not exists site;
       create table if not exists site.waitlist (
         email text primary key,
         use text,
         joined_at timestamptz not null default now()
       )`,
    )
    .catch((error) => {
      ready = undefined;
      throw error;
    });
  return { pool, ready };
}

export async function join(email: string, use: string): Promise<boolean> {
  const db = store();
  if (!db) return false;
  await db.ready;
  const { rowCount } = await db.pool.query(
    "insert into site.waitlist (email, use) values ($1, $2) on conflict (email) do nothing",
    [email, use || null],
  );
  if (rowCount && emailOn()) {
    await send({ to: email, ...waitlist({ selfHostUrl: SELF_HOST_URL }) }).catch((error) =>
      console.error("The waitlist email failed to send", error),
    );
  }
  return true;
}
