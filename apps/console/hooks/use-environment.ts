"use client";

import { useEffect } from "react";
import { useRoute } from "@/components/shell/router";
import { envOf } from "@/lib/names";

const LAST_ENV = "skywake:environment";

function remembered() {
  try {
    return localStorage.getItem(LAST_ENV) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The environment in the address, or of the index there, or the last one opened. */
export function useEnvironment(): string | undefined {
  const route = useRoute();
  const env = "env" in route ? route.env : "index" in route ? envOf(route.index) : undefined;
  useEffect(() => {
    if (!env) return;
    try {
      localStorage.setItem(LAST_ENV, env);
    } catch {}
  }, [env]);
  return env ?? remembered();
}
