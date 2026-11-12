import { BASE_PATH, routes } from "@skywake/contract";

import { PREFIX, ROUTES } from "../features/compat/paths.ts";

const ACTIONS = new Map(
  Object.values(routes)
    .flat()
    .map((route) => [
      `${route.method.toUpperCase()} ${BASE_PATH}${route.path.replace(/\{([^}]+)\}/g, ":$1")}`,
      route.operationId as string,
    ]),
);
for (const route of ROUTES) ACTIONS.set(`${route.method} ${PREFIX}${route.path}`, route.action);

export const actionOf = (method: string, route: string) => ACTIONS.get(`${method} ${route}`);
