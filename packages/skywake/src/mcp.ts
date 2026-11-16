#!/usr/bin/env node
import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Skywake } from "@skywake/sdk";
import { z } from "zod";

import { BASH_DESCRIPTION } from "./describe.ts";
import { run } from "./run.ts";
import { createShell } from "./shell.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name}`);
  return value;
}

const client = new Skywake({ url: required("SKYWAKE_URL"), key: required("SKYWAKE_KEY") });
const branch = client
  .namespace(required("SKYWAKE_NAMESPACE"))
  .branch(process.env.SKYWAKE_BRANCH ?? "main");
const shell = createShell(branch);

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
const server = new McpServer({ name: "skywake-bash", version });
server.registerTool(
  "bash",
  { description: BASH_DESCRIPTION, inputSchema: { command: z.string() } },
  async ({ command }) => {
    const ran = await run(shell, command, { commit: command });
    const text = [ran.stdout, ran.stderr && `stderr:\n${ran.stderr}`, `exit ${ran.exitCode}`]
      .filter(Boolean)
      .join("\n");
    return { content: [{ type: "text", text }], isError: ran.exitCode !== 0 };
  },
);
await server.connect(new StdioServerTransport());
