import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

import type { z } from "zod";

export { apiEnv } from "./api.ts";
export { consoleEnv, hostedEnv } from "./console.ts";

export function loadEnv(from = process.cwd()) {
  const file = findEnvFile(from);
  if (!file) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    process.env[key] ??= value;
  }
}

function findEnvFile(dir: string): string | undefined {
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  const file = join(dir, ".env");
  return existsSync(file) ? file : undefined;
}

export function readEnv<T extends z.ZodType>(
  schema: T,
  env: Record<string, string | undefined> = process.env,
): z.output<T> {
  const set = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const parsed = schema.safeParse(set);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"),
    );
  }
  return parsed.data;
}
