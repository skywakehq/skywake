import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Org = { id: string; name: string };

/** Who the app is signed in as. The tokens stay in the Keychain, on the Rust side. */
export type Profile = {
  organization: Org;
  organizations: Org[];
  environment: string | null;
  role: "read" | "write" | "admin";
  email: string | null;
};

/** A disk, such as `prod/website`: its environment is the part before the slash. */
export type Disk = { name: string; region: string };

export type Branch = { name: string; forked_from: string | null; protected: boolean };

/** A commit. `time` is in seconds. */
export type Commit = { message: string; time: number };

/** A disk's branch mounted on this Mac, and how it is doing. */
export type Drive = {
  disk: string;
  branch: string;
  path: string;
  state: "mounted" | "syncing" | "error";
  pending: number;
  error: string | null;
  /** Milliseconds since 1970. */
  saved_at: number | null;
};

export type Agent = "claude-code" | "cursor";

/** What adding an agent would write, shown before anything is written. */
export type AgentPlan = { file: string; name: string; entry: string; replaces: boolean };

/** The app's Rust side. Errors come back as plain strings; "signed-out" means sign in again. */
export const desktop = {
  profile: () => invoke<Profile | null>("profile"),
  signIn: (org?: string) => invoke<Profile>("sign_in", { org: org ?? null }),
  cancelSignIn: () => invoke<void>("cancel_sign_in"),
  signOut: () => invoke<void>("sign_out"),
  disks: () => invoke<Disk[]>("disks"),
  branches: (disk: string) => invoke<Branch[]>("branches", { disk }),
  commits: (disk: string, branch: string) => invoke<Commit[]>("commits", { disk, branch }),
  drives: () => invoke<Drive[]>("drives"),
  mount: (disk: string, branch: string) => invoke<string>("mount", { disk, branch }),
  unmount: (disk: string, branch: string) => invoke<void>("unmount", { disk, branch }),
  reveal: (path: string) => invoke<void>("reveal", { path }),
  openTerminal: (path: string) => invoke<void>("open_terminal", { path }),
  openConsole: (disk: string) => invoke<void>("open_console", { disk }),
  mcpConfig: (disk: string, branch: string) => invoke<string>("mcp_config", { disk, branch }),
  agentPlan: (agent: Agent, disk: string, branch: string) =>
    invoke<AgentPlan>("agent_plan", { agent, disk, branch }),
  agentAdd: (agent: Agent, disk: string, branch: string) =>
    invoke<string>("agent_add", { agent, disk, branch }),
  /** Each returns a promise of a function that stops listening. */
  onDrives: (then: (drives: Drive[]) => void) => listen<Drive[]>("drives", (e) => then(e.payload)),
  onSignedOut: (then: () => void) => listen("signed-out", then),
  onMenuError: (then: (error: string) => void) =>
    listen<string>("menu-error", (e) => then(e.payload)),
};

/** `prod/website` is `website` in `prod`. */
export function split(name: string) {
  const at = name.indexOf("/");
  return at < 0 ? { env: "", label: name } : { env: name.slice(0, at), label: name.slice(at + 1) };
}

/** `~/Skywake/prod/website`, as people write it. */
export function tilde(path: string) {
  return path.replace(/^\/Users\/[^/]+/, "~");
}
