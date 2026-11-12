import "server-only";

import { randomUUID } from "node:crypto";
import { APIError, type GenericEndpointContext } from "better-auth";
import { getSessionFromCtx } from "better-auth/api";
import { addressOf } from "./address";
import { withBase } from "@/lib/zone";

// The console's own events, such as sign-ins, go to the API's audit log, next
// to everything that reached the API. They wait in memory and are sent every
// second, so a person's request never waits on the API.

type ConsoleEvent = {
  at: string;
  org: string | null;
  actor: string | null;
  action: string;
  outcome: "ok" | "denied" | "rejected" | "error";
  status: number;
  method: string;
  route: string;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown> | null;
};

const FLUSH_MS = 1000;
const BATCH = 1000;
const HELD_MAX = 10_000;

let held: ConsoleEvent[] = [];
let dropped = 0;
let timer: NodeJS.Timeout | null = null;

// Only these fields of a request go in the log: never passwords, codes or tokens.
const SAFE_FIELDS = ["email", "organizationId", "memberIdOrEmail", "role", "userId", "providerId"];

// Who made each auth call, learned before it ran: some routes don't hand
// their session to the after-hook, and sign-out deletes it.
const callers = new WeakMap<Request, string>();

/** Notes who is calling an auth route, before it runs. */
export async function learnCaller(ctx: GenericEndpointContext) {
  if (!ctx.request || ctx.request.method === "GET") return;
  const found = await getSessionFromCtx(ctx).catch(() => null);
  if (found) callers.set(ctx.request, found.user.id);
}

/**
 * Records one call to the auth routes, after it ran. Calls made inside the
 * console are skipped. A call outside any organization, such as a sign-in,
 * goes to every organization of the person, so each one's admins see it.
 */
export function recordAuth(ctx: GenericEndpointContext) {
  const request = ctx.request;
  if (!request || request.method === "GET") return;
  // An after-hook sees what the route gave back: an APIError when it refused.
  const { returned } = ctx.context as { returned?: unknown };
  const status = returned instanceof APIError ? returned.statusCode : 200;
  const session = ctx.context.newSession ?? ctx.context.session;
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const details = Object.fromEntries(
    SAFE_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]),
  );
  if (session?.user.email) details.email = session.user.email;
  const event: ConsoleEvent = {
    at: new Date().toISOString(),
    org:
      (session?.session as { activeOrganizationId?: string } | undefined)?.activeOrganizationId ??
      null,
    actor: session?.user.id ?? callers.get(request) ?? null,
    action: `auth.${camel(ctx.path)}`,
    outcome:
      status < 400
        ? "ok"
        : status === 401 || status === 403
          ? "denied"
          : status < 500
            ? "rejected"
            : "error",
    status,
    method: request.method,
    route: withBase(`/api/auth${ctx.path}`),
    requestId: randomUUID(),
    ip: addressOf(request.headers),
    userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    details: Object.keys(details).length > 0 ? details : null,
  };
  if (event.org || !event.actor) return hold(event);
  void orgsOf(ctx, event.actor).then((orgs) => {
    for (const org of orgs.length > 0 ? orgs : [null]) hold({ ...event, org });
  });
}

async function orgsOf(ctx: GenericEndpointContext, userId: string) {
  try {
    const members = await ctx.context.adapter.findMany<{ organizationId: string }>({
      model: "member",
      where: [{ field: "userId", value: userId }],
    });
    return members.map((member) => member.organizationId);
  } catch {
    return [];
  }
}

function hold(event: ConsoleEvent) {
  if (held.length >= HELD_MAX) {
    dropped++;
    return;
  }
  held.push(event);
  timer ??= setTimeout(() => void flush(), FLUSH_MS);
}

async function flush() {
  timer = null;
  if (dropped > 0) {
    held.unshift({
      ...held[0]!,
      action: "console.auditEventsDropped",
      details: { count: dropped },
    });
    dropped = 0;
  }
  const batch = held.splice(0, BATCH);
  try {
    const response = await fetch(`${process.env.SKYWAKE_API_URL}/audit/events`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SKYWAKE_API_ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ events: batch }),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  } catch (error) {
    // Kept for the next try, unless that would hold too many.
    held = [...batch, ...held].slice(0, HELD_MAX);
    console.error("audit events not sent", String(error));
    timer ??= setTimeout(() => void flush(), FLUSH_MS * 5);
    return;
  }
  if (held.length > 0) timer ??= setTimeout(() => void flush(), 0);
}

/** `/sign-in/email` → `signInEmail`. */
const camel = (path: string) =>
  path
    .split(/[/-]/)
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join("");
