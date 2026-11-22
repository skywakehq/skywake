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
    command: (setup) => `claude mcp add skywake ${flags("-e", setup)} -- npx -y skywake mcp`,
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
    command: (setup) => `gemini mcp add ${flags("-e", setup)} skywake npx -y skywake mcp`,
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

/** A first thing to ask the agent, so it tries the disk and its branches. */
export function starterPrompt(disk: string) {
  return `Use the Skywake disk "${disk}" as your workspace. Write a short notes.md there saying what you're working on, then keep your files on the disk as you go. When a piece of work is done, merge your branch into main.`;
}
