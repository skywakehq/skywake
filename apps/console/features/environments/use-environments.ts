"use client";

import { useQuery } from "@rocicorp/zero/react";
import { useMemo } from "react";
import { queries } from "@/zero/queries";
import { envOf } from "@/lib/names";

export type Env = { name: string };

/**
 * Every environment, in name order. skywake-api keeps one row for each; a
 * filesystem made a moment ago may name one before its row arrives.
 */
export function useEnvironments() {
  const [made, result] = useQuery(queries.environments());
  const [namespaces] = useQuery(queries.namespaces());
  const envs = useMemo(() => {
    const all = new Set(made.map((env) => env.name));
    for (const ns of namespaces) all.add(envOf(ns.name));
    return [...all].map((name): Env => ({ name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [made, namespaces]);
  return { envs, loaded: result.type === "complete" };
}
