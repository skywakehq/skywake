#!/usr/bin/env node
import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Skywake } from "@skywake/sdk";

import { indexTools } from "./mcp/indexes.ts";

const sky = new Skywake();
const write = (await sky.whoami()).role !== "read";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
const server = new McpServer({ name: "skywake", version });
indexTools(server, sky, write);
await server.connect(new StdioServerTransport());
