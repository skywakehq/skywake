export const DEFAULT_URL = "https://api.skywake.dev";

export interface Asked {
  key?: string;
  url?: string;
  environment?: string;
  profile?: string;
}

export interface Settings {
  key: string;
  url: string;
  environment: string | undefined;
}

type Profile = Partial<Record<"key" | "url" | "environment", string>>;

interface Node {
  env: Record<string, string | undefined>;
  platform: string;
  getBuiltinModule?: (name: string) => unknown;
}

const node = (globalThis as { process?: Node }).process;

const env = (name: string) => node?.env[name] || undefined;

export function credentialsPath(): string | undefined {
  if (!node) return undefined;
  if (node.platform === "win32" && env("APPDATA"))
    return `${env("APPDATA")}\\skywake\\credentials.toml`;
  const base = env("XDG_CONFIG_HOME") ?? (env("HOME") && `${env("HOME")}/.config`);
  return base && `${base}/skywake/credentials.toml`;
}

export function parseCredentials(text: string): Record<string, Profile> {
  const profiles: Record<string, Profile> = {};
  let current: Profile | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const table = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (table) {
      current = profiles[table[1]!] ??= {};
      continue;
    }
    const pair = /^([A-Za-z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"$/.exec(line);
    if (pair && current && ["key", "url", "environment"].includes(pair[1]!)) {
      current[pair[1] as keyof Profile] = JSON.parse(`"${pair[2]}"`) as string;
    }
  }
  return profiles;
}

function readProfile(name: string): Profile | undefined {
  const path = credentialsPath();
  const fs = node?.getBuiltinModule?.("node:fs") as
    | { readFileSync(path: string, encoding: "utf8"): string }
    | undefined;
  if (!path || !fs) return undefined;
  try {
    return parseCredentials(fs.readFileSync(path, "utf8"))[name];
  } catch {
    return undefined;
  }
}

export function resolveSettings(asked: Asked = {}): Settings {
  const given = asked.key ?? env("SKYWAKE_API_KEY") ?? env("SKYWAKE_KEY");
  const profile = given
    ? undefined
    : readProfile(asked.profile ?? env("SKYWAKE_PROFILE") ?? "default");
  const key = given ?? profile?.key;
  if (!key) {
    throw new Error(
      "no Skywake API key: run `npx skywake login`, set SKYWAKE_API_KEY, or pass { key }",
    );
  }
  return {
    key,
    url: asked.url ?? env("SKYWAKE_URL") ?? profile?.url ?? DEFAULT_URL,
    environment: asked.environment ?? env("SKYWAKE_ENV") ?? profile?.environment,
  };
}
