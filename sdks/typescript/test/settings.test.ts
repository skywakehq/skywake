import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Skywake } from "../dist/index.js";

const NAMES = ["SKYWAKE_API_KEY", "SKYWAKE_KEY", "SKYWAKE_URL", "SKYWAKE_ENV", "SKYWAKE_PROFILE"];

function isolate(t: { after: (fn: () => void) => void }) {
  const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
  const home = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  for (const name of NAMES) delete process.env[name];
  const dir = mkdtempSync(join(tmpdir(), "skywake-settings-"));
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => {
    for (const [name, value] of Object.entries({ ...saved, ...home })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  return (text: string) => {
    mkdirSync(join(dir, "skywake"), { recursive: true });
    writeFileSync(join(dir, "skywake", "credentials.toml"), text);
  };
}

async function echo() {
  let seen: Record<string, string | undefined> = {};
  const server = createServer((request, response) => {
    seen = {
      authorization: request.headers.authorization,
      environment: request.headers["skywake-environment"] as string | undefined,
      path: request.url,
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ organization: "o", environment: "prod" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, seen: () => seen, close: () => server.close() };
}

test("with nothing set, the error says how to sign in", (t) => {
  isolate(t);
  assert.throws(() => new Skywake(), /npx skywake login/);
});

test("the key and URL come from the environment, and the URL defaults to the cloud", (t) => {
  isolate(t);
  process.env.SKYWAKE_API_KEY = "sw_env";
  assert.equal(new Skywake().url, "https://api.skywake.dev");
  process.env.SKYWAKE_URL = "http://localhost:8080/";
  assert.equal(new Skywake().url, "http://localhost:8080");
});

test("a profile from the credentials file is used when no key is given", async (t) => {
  const write = isolate(t);
  const api = await echo();
  t.after(api.close);
  write(
    `[default]\nkey = "sw_file"\nurl = "${api.url}"\nenvironment = "prod"\n\n` +
      `[staging]\nkey = "sw_staging"\nurl = "${api.url}"\n`,
  );
  const who = await new Skywake().whoami();
  assert.equal(who.environment, "prod");
  assert.deepEqual(api.seen(), {
    authorization: "Bearer sw_file",
    environment: "prod",
    path: "/v1/whoami",
  });

  process.env.SKYWAKE_PROFILE = "staging";
  await new Skywake().whoami();
  assert.equal(api.seen().authorization, "Bearer sw_staging");
  assert.equal(api.seen().environment, undefined);
});

test("code beats the environment, which beats the file", async (t) => {
  const write = isolate(t);
  const api = await echo();
  t.after(api.close);
  write(`[default]\nkey = "sw_file"\nurl = "http://127.0.0.1:1"\n`);
  process.env.SKYWAKE_API_KEY = "sw_env";
  process.env.SKYWAKE_URL = api.url;
  await new Skywake({ environment: "staging" }).whoami();
  assert.equal(api.seen().authorization, "Bearer sw_env");
  assert.equal(api.seen().environment, "staging");
  await new Skywake({ key: "sw_code", url: api.url }).whoami();
  assert.equal(api.seen().authorization, "Bearer sw_code");
});
