"use client";

import { useEffect } from "react";
import { useRoute } from "@/components/shell/router";
import { envOf } from "@/lib/names";

const LAST_NS = "skywake:namespace";
const LAST_ENV = "skywake:environment";

function remembered(key: string) {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function useRemember(key: string, value?: string) {
  useEffect(() => {
    if (!value) return;
    try {
      localStorage.setItem(key, value);
    } catch {}
  }, [key, value]);
}

/** The namespace (repo) in the address, if any. */
export function useNamespace(): string | undefined {
  const route = useRoute();
  const ns = "ns" in route ? route.ns : undefined;
  useRemember(LAST_NS, ns);
  return ns;
}

/** The environment in the address, or of the repo there, or the last one opened. */
export function useEnvironment(): string | undefined {
  const route = useRoute();
  const ns = useNamespace();
  const env =
    "env" in route ? route.env : ns ? envOf(ns) : "index" in route ? envOf(route.index) : undefined;
  useRemember(LAST_ENV, env);
  return env ?? remembered(LAST_ENV);
}
