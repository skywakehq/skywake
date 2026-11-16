import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import type { Ran } from "skywake/bash";
import { bashTool } from "skywake/ai";
import { Skywake } from "@skywake/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { listen, server, shut, skip } from "./helpers.ts";

const NS = "/namespaces/prod%2Fapp";
const WRAPPER = fileURLToPath(new URL("../bin/skywake.cjs", import.meta.resolve("skywake/bash")));

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
    environment: "prod",
    fetch: (input, init) => Promise.resolve(s.app.fetch(new Request(input, init))),
  });
  const bash = bashTool(client.disk("app"));
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

const WRITE_TOOLS = ["write", "delete", "fork", "merge", "index_upsert", "index_delete"];
const READ_TOOLS = ["read", "list", "grep", "find", "query", "log", "diff", "bash", "index_query"];

async function connected(url: string, key: string, extra: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [WRAPPER, "mcp"],
    env: {
      PATH: process.env.PATH ?? "",
      SKYWAKE_URL: url,
      SKYWAKE_API_KEY: key,
      SKYWAKE_ENV: "prod",
      SKYWAKE_DISK: "app",
      ...extra,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return { text: (result.content as { text: string }[])[0]!.text, isError: result.isError };
  };
  const names = async () => (await client.listTools()).tools.map((tool) => tool.name).sort();
  return { client, call, names };
}

test("one MCP server: files, bash and indexes, on a branch of its own", { skip }, async () => {
  const { s, key, exists } = await seeded();
  const http = await listen(s);
  const url = s.services.config.peer.url;
  try {
    await sharedServer(url, key, exists);
    await readOnly(url, key);
  } finally {
    shut(http);
  }
});

async function sharedServer(url: string, key: string, exists: (path: string) => Promise<boolean>) {
  const mcp = await connected(url, key);
  try {
    assert.deepEqual(await mcp.names(), [...READ_TOOLS, ...WRITE_TOOLS].sort());
    assert.deepEqual(await mcp.call("bash", { command: "find . -name '*.ts'" }), {
      text: "./src/app.ts\n\nexit 0",
      isError: false,
    });
    assert.deepEqual(await mcp.call("bash", { command: "mkdir docs && echo hi > docs/a.md && cat docs/a.md" }), {
      text: "hi\n\nexit 0",
      isError: false,
    });
    assert.equal(await exists("docs/a.md"), false, "the session writes to its own branch, not main");
    assert.equal((await mcp.call("read", { path: "docs/a.md" })).text, "hi\n");
    assert.equal((await mcp.call("write", { files: { "b.md": "bee" }, message: "b" })).isError, false);
    const diff = JSON.parse((await mcp.call("diff", {})).text);
    assert.deepEqual(diff.map((change: { path: string }) => change.path).sort(), ["b.md", "docs"]);
    assert.equal((await mcp.call("merge", {})).isError, false);
    assert.equal(await exists("docs/a.md"), true);
    assert.equal(await exists("b.md"), true);
    const missing = await mcp.call("bash", { command: "cat nope.txt" });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /No such file/);

    await mcp.call("index_upsert", { index: "notes", rows: [{ id: "a", text: "shoes for running" }] });
    const hits = JSON.parse((await mcp.call("index_query", { index: "notes", text: "shoes" })).text);
    assert.equal(hits[0].id, "a");
    const gone = await mcp.call("index_query", { index: "nots", text: "shoes" });
    assert.equal(gone.isError, true);
    assert.match(gone.text, /did you mean `notes`/);
  } finally {
    await mcp.client.close();
  }
}

async function readOnly(url: string, key: string) {
  const sky = new Skywake({ url, key, environment: "prod" });
  const reader = await sky.createKey({ name: "reader", role: "read", environment: "prod" });
  const read = await connected(url, reader.key);
  try {
    assert.deepEqual(await read.names(), [...READ_TOOLS].sort());
    assert.equal((await read.call("read", { path: "b.md" })).text, "bee");
  } finally {
    await read.client.close();
  }
}
