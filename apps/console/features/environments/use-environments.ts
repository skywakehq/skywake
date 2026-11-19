"use client";

import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@/zero/queries";

export type Env = { name: string };

/** Every environment, in name order. skywake-api keeps one row for each. */
export function useEnvironments() {
  const [made, result] = useQuery(queries.environments());
  const envs = made.map((env): Env => ({ name: env.name }));
  return { envs, loaded: result.type === "complete" };
}
