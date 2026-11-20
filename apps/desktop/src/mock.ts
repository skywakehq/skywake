// Stands in for the Rust side when the window is opened in a plain browser
// (`pnpm web`), so the design can be worked on without the app. Development only.
// `?state=out|waiting|empty|offline|mount-error` opens on that state.

import type { Branch, Commit, Disk, Drive, Profile } from "./desktop";

const ask = new URLSearchParams(location.search).get("state") ?? "";
const now = Date.now() / 1000;
const home = "/Users/you";

const profile: Profile = {
  organization: { id: "org_acme", name: "Acme" },
  organizations: [
    { id: "org_acme", name: "Acme" },
    { id: "org_lab", name: "Acme Labs" },
  ],
  environment: null,
  role: "admin",
  email: "dev@acme.test",
};

const disks: Disk[] = [
  { name: "prod/website", region: "us-east-1" },
  { name: "prod/api", region: "us-east-1" },
  { name: "prod/support-agent", region: "eu-central-1" },
  { name: "staging/website", region: "us-west-2" },
  { name: "staging/research-notes", region: "us-west-2" },
  { name: "dev/scratch", region: "ap-south-1" },
];

const branches: Branch[] = [
  { name: "main", forked_from: null, protected: true },
  { name: "agents/fix-login", forked_from: "main", protected: false },
  { name: "agents/new-pricing-page", forked_from: "main", protected: false },
];

const commits: Commit[] = [
  { message: "Saved pricing.mdx from Studio", time: now - 50 },
  { message: "Merge agents/fix-login into main", time: now - 60 * 12 },
  { message: "Moved draft.md to launch-plan.md from Studio", time: now - 60 * 48 },
  { message: "Rewrite the onboarding copy", time: now - 3600 * 5 },
  { message: "Saved 4 files from Studio", time: now - 3600 * 29 },
];

const path = (disk: string, branch: string) => {
  const [env, name] = disk.split("/");
  const leaf = branch === "main" ? name : `${name}@${branch.replaceAll("/", "-")}`;
  return `${home}/Skywake/${env}/${leaf}`;
};

let signedIn = !["out", "waiting"].includes(ask);
let drives: Drive[] = [
  {
    disk: "prod/website",
    branch: "main",
    path: path("prod/website", "main"),
    state: "syncing",
    pending: 3,
    error: null,
    saved_at: Date.now() - 40_000,
  },
  {
    disk: "prod/support-agent",
    branch: "main",
    path: path("prod/support-agent", "main"),
    state: ask === "mount-error" ? "error" : "mounted",
    pending: 0,
    error:
      ask === "mount-error"
        ? "Could not reach Skywake. Changes are kept and saved once it answers."
        : null,
    saved_at: Date.now() - 600_000,
  },
];
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

// Listeners the window registered, so events can reach them.
const callbacks = new Map<number, (event: unknown) => void>();
const listeners = new Map<string, number[]>();
let next = 1;
function emit(event: string, payload: unknown) {
  for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
}

// The syncing drive settles after a moment, as a real one would.
setTimeout(() => {
  drives = drives.map((d) =>
    d.state === "syncing" ? { ...d, state: "mounted", pending: 0, saved_at: Date.now() } : d,
  );
  emit("drives", drives);
}, 6000);

const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
  profile: () => (signedIn ? profile : null),
  sign_in: async () => {
    if (ask === "waiting") await new Promise(() => {});
    await wait(2200);
    signedIn = true;
    return profile;
  },
  cancel_sign_in: () => {},
  sign_out: async () => {
    await wait(500);
    signedIn = false;
    drives = [];
    emit("signed-out", null);
  },
  disks: async () => {
    await wait(400);
    if (ask === "offline") throw "Could not reach Skywake at https://api.skywake.dev.";
    return ask === "empty" ? [] : disks;
  },
  branches: async () => branches,
  commits: async ({ disk }) => (disk === "dev/scratch" ? [] : commits),
  drives: () => drives,
  mount: async ({ disk, branch }) => {
    await wait(1400);
    if (disk === "dev/scratch" && ask === "mount-error")
      throw "macOS would not mount the folder: mount_nfs: can't mount / from localhost onto ~/Skywake/dev/scratch: Permission denied";
    const drive: Drive = {
      disk: String(disk),
      branch: String(branch),
      path: path(String(disk), String(branch)),
      state: "mounted",
      pending: 0,
      error: null,
      saved_at: null,
    };
    drives = [...drives, drive];
    emit("drives", drives);
    return drive.path;
  },
  unmount: async ({ disk, branch }) => {
    await wait(700);
    drives = drives.filter((d) => d.disk !== disk || d.branch !== branch);
    emit("drives", drives);
  },
  reveal: () => {},
  open_terminal: () => {},
  open_console: () => {},
  mcp_config: ({ disk, branch }) => {
    const [env, name] = String(disk).split("/");
    const key = `skywake-${String(disk).replaceAll("/", "-")}`;
    return JSON.stringify(
      {
        mcpServers: {
          [key]: {
            command: "npx",
            args: ["-y", "skywake", "mcp"],
            env: {
              SKYWAKE_URL: "https://api.skywake.dev",
              SKYWAKE_ENV: env,
              SKYWAKE_DISK: name,
              SKYWAKE_BRANCH: branch,
            },
          },
        },
      },
      null,
      2,
    );
  },
  agent_plan: ({ agent, disk, branch }) => ({
    file: agent === "cursor" ? `${home}/.cursor/mcp.json` : `${home}/.claude.json`,
    name: `skywake-${String(disk).replaceAll("/", "-")}`,
    entry: commands.mcp_config!({ disk, branch }),
    replaces: false,
  }),
  agent_add: async ({ agent }) => {
    await wait(300);
    return agent === "cursor" ? `${home}/.cursor/mcp.json` : `${home}/.claude.json`;
  },
  "plugin:event|listen": ({ event, handler }) => {
    const id = Number(handler);
    listeners.set(String(event), [...(listeners.get(String(event)) ?? []), id]);
    return id;
  },
  "plugin:event|unlisten": () => {},
};

Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke: async (command: string, args: Record<string, unknown>) => commands[command]?.(args),
    transformCallback: (callback: (event: unknown) => void) => {
      const id = next++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
});
export {};
