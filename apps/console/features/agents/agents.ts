import { MARKS } from "./marks";

/** What an agent's MCP server needs: the key, the disk, and the API when it isn't ours. */
export type Setup = { key: string; disk: string; api: string };

const HOSTED = "https://api.skywake.dev";

function envOf({ key, disk, api }: Setup) {
  return {
    SKYWAKE_API_KEY: key,
    SKYWAKE_DISK: disk,
    ...(api.replace(/\/$/, "") !== HOSTED && { SKYWAKE_URL: api }),
  };
}

const SERVER = { command: "npx", args: ["-y", "skywake", "mcp"] };

const quote = (value: string) => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${value}'`);
const flags = (flag: string, setup: Setup) =>
  Object.entries(envOf(setup))
    .map(([name, value]) => `${flag} ${name}=${quote(value)}`)
    .join(" ");

/** The JSON most agents read from their MCP config file. */
export function mcpJson(setup: Setup) {
  return JSON.stringify({ mcpServers: { skywake: { ...SERVER, env: envOf(setup) } } }, null, 2);
}

export type Agent = {
  id: string;
  name: string;
  mark: string;
  tile: string;
  ink: string;
  /** A command to paste in a terminal. */
  command?: (setup: Setup) => string;
  /** A link that installs the server in one click. */
  link?: (setup: Setup) => { href: string; label: string };
  /** Where the JSON goes, for agents set up by file. */
  file?: string;
};

export const AGENTS: Agent[] = [
  {
    id: "claude",
    name: "Claude Code",
    mark: MARKS.claude,
    tile: "#d97757",
    ink: "#fff",
    // User scope, so it is there in every folder, not just the one it was added in.
    command: (setup) =>
      `claude mcp add -s user skywake ${flags("-e", setup)} -- npx -y skywake mcp`,
  },
  {
    id: "codex",
    name: "Codex",
    mark: MARKS.codex,
    tile: "#0d0d0d",
    ink: "#fff",
    command: (setup) => `codex mcp add skywake ${flags("--env", setup)} -- npx -y skywake mcp`,
  },
  {
    id: "cursor",
    name: "Cursor",
    mark: MARKS.cursor,
    tile: "#14120b",
    ink: "#edecec",
    link: (setup) => ({
      label: "Add to Cursor",
      href: `cursor://anysphere.cursor-deeplink/mcp/install?name=skywake&config=${encodeURIComponent(
        btoa(JSON.stringify({ ...SERVER, env: envOf(setup) })),
      )}`,
    }),
    file: "~/.cursor/mcp.json",
  },
  {
    id: "vscode",
    name: "VS Code",
    mark: MARKS.copilot,
    tile: "linear-gradient(135deg, #8534f3, #2f7bf6)",
    ink: "#fff",
    link: (setup) => ({
      label: "Add to VS Code",
      href: `vscode:mcp/install?${encodeURIComponent(
        JSON.stringify({ name: "skywake", ...SERVER, env: envOf(setup) }),
      )}`,
    }),
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    mark: MARKS.gemini,
    tile: "#fff",
    ink: "#4285f4",
    command: (setup) => `gemini mcp add -s user ${flags("-e", setup)} skywake npx -y skywake mcp`,
  },
  {
    id: "windsurf",
    name: "Windsurf",
    mark: MARKS.windsurf,
    tile: "#0b100f",
    ink: "#58e5bb",
    file: "~/.codeium/windsurf/mcp_config.json",
  },
];

/**
 * The first thing to paste into the agent. Each step names the tool to call and
 * how to tell it worked, and it says where things go wrong most: an agent
 * started before the server was added, and writing to its own computer instead.
 */
export function starterPrompt(disk: string) {
  return `Check that Skywake works. Skywake is an MCP server named "skywake". Its tools (list, read, write, merge and more) work on a remote disk named "${disk}", and already point at it.

1. Look for the skywake tools. If you don't have them, stop and reply: "I can't see the Skywake tools. Start a new session, then paste this again."
2. Call skywake's list tool. Any answer without an error means you're connected. An empty disk is fine.
3. Call skywake's write tool to create notes.md with one line: "Connected on <today's date>." Use skywake's tool, not your own file tools: the file goes on the disk, not on this computer.
4. Call skywake's read tool on notes.md and check the line is there.
5. Your writes went to a branch of your own. Call skywake's merge tool to merge it into main. If it lists conflicts, stop and show them to me.
6. Reply in one line: "Skywake works: notes.md is on ${disk}."

From now on, when I ask you to save, find or share work on Skywake, use the skywake tools.`;
}
