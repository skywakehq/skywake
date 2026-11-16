#!/usr/bin/env node
import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Skywake } from "@skywake/sdk";

import { fileTools } from "./mcp/files.ts";
import { indexTools } from "./mcp/indexes.ts";
import { Places } from "./mcp/places.ts";

const sky = new Skywake();
const write = (await sky.whoami()).role !== "read";
const places = new Places(sky, process.env.SKYWAKE_DISK, process.env.SKYWAKE_BRANCH);

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
const server = new McpServer({ name: "skywake", version });
fileTools(server, places, write);
indexTools(server, sky, write);
await server.connect(new StdioServerTransport());
