import { randomBytes } from "node:crypto";
import { type IncomingMessage, Server } from "node:http";
import { Server as SecureServer } from "node:https";
import { BlockList, isIP } from "node:net";

/** The header the console's own server writes the client's address into. */
const STAMP = "x-skywake-client";
const SECRET = Symbol.for("skywake.console.address-secret");

type Stamped = typeof globalThis & { [SECRET]?: string };

const plain = (address: string) => address.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");

const family = (address: string) => (isIP(address) === 6 ? "ipv6" : "ipv4");

/** Reads TRUSTED_PROXIES: addresses or CIDRs, split by commas or spaces. */
export function trustedProxies(setting: string) {
  const list = new BlockList();
  for (const entry of setting.split(/[\s,]+/).filter(Boolean)) {
    const [address = "", bits, extra] = entry.split("/");
    const version = isIP(address);
    const most = version === 6 ? 128 : 32;
    const prefix = bits === undefined ? most : Number(bits);
    if (!version || extra !== undefined || !/^\d+$/.test(bits ?? "0") || prefix > most) {
      throw new Error(`TRUSTED_PROXIES: \`${entry}\` is not an address or a CIDR`);
    }
    list.addSubnet(address, prefix, family(address));
  }
  return list;
}

function trusts(list: BlockList, address: string) {
  return isIP(address) !== 0 && list.check(address, family(address));
}

/**
 * Who sent a request. It is the socket's address, unless that is a trusted
 * proxy. Then it is the nearest address in X-Forwarded-For that is not a
 * trusted proxy, or X-Real-IP when there is no X-Forwarded-For. Addresses a
 * client wrote further left in X-Forwarded-For are never used.
 */
export function clientAddress(
  socket: string | undefined,
  forwardedFor: string | undefined,
  realIp: string | undefined,
  trusted: BlockList,
) {
  if (!socket) return null;
  let address = plain(socket);
  if (!trusts(trusted, address)) return address;
  const hops = (forwardedFor ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  if (hops.length === 0) return realIp?.trim() ? plain(realIp.trim()) : address;
  for (const hop of hops.reverse()) {
    address = plain(hop);
    if (!trusts(trusted, address)) return address;
  }
  return address;
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Makes the console's server note each request's real client address before
 * Next reads it. Route handlers only see headers, which a client can write,
 * so the address goes into a header signed with a secret only this process
 * knows. X-Forwarded-For and X-Real-IP are rewritten too, so Better Auth sees
 * the same address. Runs once, from instrumentation.ts.
 */
export function noteClientAddresses(trusted: BlockList) {
  const stamped = globalThis as Stamped;
  if (stamped[SECRET]) return;
  const secret = randomBytes(16).toString("hex");
  stamped[SECRET] = secret;
  for (const kind of [Server, SecureServer]) {
    const emit = kind.prototype.emit as (
      this: Server,
      event: string | symbol,
      ...args: unknown[]
    ) => boolean;
    kind.prototype.emit = function (this: Server, event: string | symbol, ...args: unknown[]) {
      if (event === "request") {
        const request = args[0] as IncomingMessage;
        const headers = request.headers;
        const address = clientAddress(
          request.socket.remoteAddress,
          one(headers["x-forwarded-for"]),
          one(headers["x-real-ip"]),
          trusted,
        );
        const socket = plain(request.socket.remoteAddress ?? "");
        const via = trusts(trusted, socket) ? "proxy" : "direct";
        headers[STAMP] = `${secret} ${address ?? ""} ${via}`;
        delete headers["x-real-ip"];
        delete headers["x-forwarded-for"];
        if (address) {
          headers["x-real-ip"] = address;
          headers["x-forwarded-for"] = address;
        }
      }
      return emit.call(this, event, ...args);
    } as Server["emit"];
  }
}

/**
 * The client's address, as the console's server noted it. "unknown" when
 * the request was not noted, so an IP allowlist refuses it rather than
 * trusting a header.
 *
 * `forwarded`: the request comes from a service such as zero-cache, so its
 * own address says nothing about the person. Then the address counts only if
 * that service is a trusted proxy; otherwise it is "unknown" too.
 */
export function addressOf(headers: Headers, { forwarded = false } = {}) {
  const secret = (globalThis as Stamped)[SECRET];
  const [given, address, via] = (headers.get(STAMP) ?? "").split(" ");
  if (!secret || given !== secret || !address) return "unknown";
  return forwarded && via !== "proxy" ? "unknown" : address;
}
