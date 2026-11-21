"use client";

import { useEffect } from "react";
import { navigate } from "@/components/shell/router";
import { envPath } from "@/lib/paths";
import { useEnvironment } from "@/hooks/use-ns";
import { useEnvironments } from "./use-environments";

/** Opens the last environment, or the first. */
export function Home() {
  const last = useEnvironment();
  const { envs, loaded } = useEnvironments();
  const names = envs.map((env) => env.name);
  const target = last && names.includes(last) ? last : (names[0] ?? (loaded ? "prod" : undefined));

  useEffect(() => {
    if (target) navigate(envPath(target), { replace: true });
  }, [target]);

  return null;
}
