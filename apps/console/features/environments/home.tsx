"use client";

import { useEffect } from "react";
import { navigate } from "@/components/shell/router";
import { envPath } from "@/lib/paths";
import { useEnvironment } from "@/hooks/use-ns";
import { useEnvironments } from "./use-environments";

/**
 * Opens the disks of the last environment, or the first. The last one is
 * opened at once, without waiting for the list to sync.
 */
export function Home() {
  const last = useEnvironment();
  const { envs, loaded } = useEnvironments();
  const names = envs.map((env) => env.name);
  const gone = loaded && last !== undefined && !names.includes(last);
  const target = last && !gone ? last : (names[0] ?? (loaded ? "prod" : undefined));

  useEffect(() => {
    if (target) navigate(envPath(target), { replace: true });
  }, [target]);

  return null;
}
