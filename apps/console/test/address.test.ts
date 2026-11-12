import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import {
  addressOf,
  clientAddress,
  noteClientAddresses,
  trustedProxies,
} from "../server/address.ts";

const none = trustedProxies("");
const proxy = trustedProxies("10.0.0.0/8, ::1");

test("with no trusted proxy, the socket's address wins over any header", () => {
  assert.equal(clientAddress("127.0.0.1", "10.1.1.7", "10.1.1.7", none), "127.0.0.1");
  assert.equal(clientAddress("::ffff:203.0.113.5", undefined, undefined, none), "203.0.113.5");
});

test("behind a trusted proxy, the nearest untrusted forwarded address wins", () => {
  // The client wrote 1.2.3.4; the proxy appended the address it saw.
  assert.equal(
    clientAddress("10.0.0.2", "1.2.3.4, 198.51.100.9", undefined, proxy),
    "198.51.100.9",
  );
  assert.equal(
    clientAddress("10.0.0.2", "198.51.100.9, 10.0.0.3", undefined, proxy),
    "198.51.100.9",
  );
  assert.equal(clientAddress("10.0.0.2", undefined, "198.51.100.9", proxy), "198.51.100.9");
  assert.equal(clientAddress("10.0.0.2", undefined, undefined, proxy), "10.0.0.2");
});

test("a bad TRUSTED_PROXIES entry is refused", () => {
  assert.throws(() => trustedProxies("10.0.0.0/33"), /TRUSTED_PROXIES/);
  assert.throws(() => trustedProxies("proxy.local"), /TRUSTED_PROXIES/);
});

test("a request nobody noted has an unknown address", () => {
  assert.equal(addressOf(new Headers({ "x-real-ip": "10.1.1.7" })), "unknown");
  assert.equal(addressOf(new Headers({ "x-skywake-client": "guess 10.1.1.7" })), "unknown");
});

test("the server notes the socket's address, whatever the client sends; an untrusted relay gives none", async () => {
  noteClientAddresses(none);
  const seen: string[] = [];
  const server = createServer((request, response) => {
    const headers = new Headers(request.headers as Record<string, string>);
    seen.push(
      addressOf(headers),
      headers.get("x-forwarded-for") ?? "",
      // As if zero-cache sent it: zero-cache is not a trusted proxy here.
      addressOf(headers, { forwarded: true }),
    );
    response.end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await fetch(`http://127.0.0.1:${port}/`, {
    headers: {
      "x-real-ip": "10.1.1.7",
      "x-forwarded-for": "10.1.1.7",
      "x-skywake-client": "x 10.1.1.7",
    },
  });
  server.close();
  assert.deepEqual(seen, ["127.0.0.1", "127.0.0.1", "unknown"]);
});
