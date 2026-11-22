#!/usr/bin/env node
import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Skywake } from "@skywake/sdk";

import { fileTools } from "./mcp/files.ts";
import { Places } from "./mcp/places.ts";

const sky = new Skywake();
// Asked while the client connects, so the handshake doesn't wait a round trip
// to the API. It is also the call that marks the key as used in the console.
const whoami = sky.whoami();
const write = whoami.then((me) => me.role !== "read");
const places = new Places(sky, process.env.SKYWAKE_DISK, process.env.SKYWAKE_BRANCH);

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
const server = new McpServer({ name: "skywake", version });
fileTools(server, places, write);
await server.connect(new StdioServerTransport());

try {
  await whoami;
} catch (error) {
  // A key the API refuses ends the server, as it did when this ran first.
  console.error(`skywake: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
