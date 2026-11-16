import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { createShell, type Ran } from "skywake/bash";
import { bashTool } from "skywake/ai";
import { Skywake } from "@skywake/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { listen, server, shut, skip } from "./helpers.ts";

const NS = "/namespaces/prod%2Fapp";
const MCP = fileURLToPath(import.meta.resolve("skywake/bash")).replace(/bash\.js$/, "mcp.js");

async function seeded() {
  const s = await server();
  const { key } = await s.ready();
  const changes = [{ path: "src/app.ts", text: "export function greet() {}\n" }];
  const done = await s.call("POST", `${NS}/branches/main/commits`, key, {
    message: "seed",
    changes,
  });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  const exists = async (path: string) =>
    (await s.call("GET", `${NS}/branches/main/files?path=${encodeURIComponent(path)}`, key))
      .status === 200;
  return { s, key, exists };
}

test("the AI SDK tool runs a command and commits what it changed", { skip }, async () => {
  const { s, key, exists } = await seeded();
  const client = new Skywake({
    url: "http://api.test",
    key,
    fetch: (input, init) => Promise.resolve(s.app.fetch(new Request(input, init))),
  });
  const bash = bashTool(createShell(client.namespace("prod/app").branch("main")));
  const call = { toolCallId: "1", messages: [] };
  const found = await bash.execute!({ command: "rg -n greet" }, call);
  assert.deepEqual(found, {
    stdout: "src/app.ts:1:export function greet() {}\n",
    stderr: "",
    exitCode: 0,
  });
  const wrote = (await bash.execute!({ command: "echo hi > notes.txt" }, call)) as Ran;
  assert.equal(wrote.exitCode, 0);
  assert.match(wrote.committed ?? "", /^[0-9a-f]{64}$/);
  assert.equal(await exists("notes.txt"), true);
  const log = await s.call("GET", `${NS}/branches/main/commits?limit=1`, key);
  assert.equal(log.body[0].message, "echo hi > notes.txt");
});

test("the MCP server offers bash over stdio", { skip }, async () => {
  const { s, key, exists } = await seeded();
  const http = await listen(s);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP],
    env: {
      PATH: process.env.PATH ?? "",
      SKYWAKE_URL: s.services.config.peer.url,
      SKYWAKE_KEY: key,
      SKYWAKE_NAMESPACE: "prod/app",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["bash"],
    );
    const text = async (command: string) => {
      const result = await client.callTool({ name: "bash", arguments: { command } });
      return {
        text: (result.content as { text: string }[])[0]!.text,
        isError: result.isError,
      };
    };
    assert.deepEqual(await text("find . -name '*.ts'"), {
      text: "./src/app.ts\n\nexit 0",
      isError: false,
    });
    assert.deepEqual(await text("mkdir docs && echo hi > docs/a.md && cat docs/a.md"), {
      text: "hi\n\nexit 0",
      isError: false,
    });
    assert.equal(await exists("docs/a.md"), true);
    const missing = await text("cat nope.txt");
    assert.equal(missing.isError, true);
    assert.match(missing.text, /No such file/);
  } finally {
    await client.close();
    shut(http);
  }
});
