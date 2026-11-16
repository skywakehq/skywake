#!/usr/bin/env node
import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Skywake } from "@skywake/sdk";
import { z } from "zod";

import { BASH_DESCRIPTION } from "./describe.ts";
import { shell as open } from "./shell.ts";

const name = process.env.SKYWAKE_DISK ?? process.env.SKYWAKE_NAMESPACE;
if (!name) throw new Error("set SKYWAKE_DISK");
const disk = new Skywake().disk(name, { branch: process.env.SKYWAKE_BRANCH });
const shell = open(disk);

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
const server = new McpServer({ name: "skywake-bash", version });
server.registerTool(
  "bash",
  { description: BASH_DESCRIPTION, inputSchema: { command: z.string() } },
  async ({ command }) => {
    const ran = await shell.run(command, { commit: command });
    const text = [ran.stdout, ran.stderr && `stderr:\n${ran.stderr}`, `exit ${ran.exitCode}`]
      .filter(Boolean)
      .join("\n");
    return { content: [{ type: "text", text }], isError: ran.exitCode !== 0 };
  },
);
await server.connect(new StdioServerTransport());
