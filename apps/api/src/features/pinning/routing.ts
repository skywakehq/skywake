import type { MiddlewareHandler } from "hono";

import type { AppEnv, Ctx, Feature } from "../../http/context.ts";
import { CLIENT_HEADER, PEER_HEADER, SERVER_HEADER } from "../../http/peers.ts";
import { clientAddress } from "../../http/rate-limit.ts";
import type { PeerRow } from "./queries.ts";

const QUERIES = ["query", "search", "hybrid", "multi", "rank", "order", "aggregate"];
const FORWARD_MS = 10_000;
const PASSED = ["authorization", "content-type", "x-request-id"];

const routed: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { pinning } = c.var.services;
  const caller = await c.var.caller();
  const pinned = caller && pinning.pinned(caller.org, c.req.param("index")!);
  if (!pinned) return next();
  const answer = async () => {
    c.header(SERVER_HEADER, pinning.id);
    await pinning.answer(pinned.folder, next);
  };
  const token = pinning.token;
  if (c.get("fromPeer") || pinning.holds(pinned.folder) || token === undefined) return answer();
  for (const replica of pinning.others(pinned.folder)) {
    const sent = await pinning.send(replica.id, () => forward(c, replica, token)).catch(() => null);
    if (sent) return sent;
  }
  return answer();
};

async function forward(c: Ctx, replica: PeerRow, token: string) {
  const headers = new Headers({
    [PEER_HEADER]: token,
    [CLIENT_HEADER]: clientAddress(c, c.var.services.config.trustProxy),
  });
  for (const name of PASSED) {
    const value = c.req.header(name);
    if (value !== undefined) headers.set(name, value);
  }
  const { pathname, search } = new URL(c.req.url);
  const sent = await fetch(`${replica.url}${pathname}${search}`, {
    method: c.req.method,
    headers,
    body: await c.req.text(),
    signal: AbortSignal.timeout(FORWARD_MS),
  });
  const kept = ["content-type", SERVER_HEADER].filter((name) => sent.headers.has(name));
  return new Response(await sent.arrayBuffer(), {
    status: sent.status,
    headers: kept.map((name): [string, string] => [name, sent.headers.get(name)!]),
  });
}

export const pinnedQueriesFeature: Feature = {
  register(api) {
    for (const query of QUERIES) api.use(`/indexes/:index/branches/:branch/${query}`, routed);
  },
};
