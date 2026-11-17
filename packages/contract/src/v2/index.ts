import { OpenAPIHono } from "@hono/zod-openapi";

import * as account from "./account.ts";
import * as common from "./common.ts";
import * as disks from "./disks.ts";
import * as indexes from "./indexes.ts";

export { account, common, disks, indexes };

export const BASE_PATH = "/v2";

export const routes = [...account.routes, ...disks.routes, ...indexes.routes];

export const info = {
  openapi: "3.1.0",
  info: {
    title: "Skywake API",
    version: "2.0.0",
    description:
      "Disks of files and indexes of rows, each with branches. Send `Authorization: Bearer " +
      "<API key>`. The key picks the environment; a key for every environment names one with " +
      "`Skywake-Environment`.",
  },
  servers: [{ url: BASE_PATH }],
};

export function describe(app: OpenAPIHono<any>) {
  app.openAPIRegistry.registerComponent("securitySchemes", "bearer", {
    type: "http",
    scheme: "bearer",
  });
}

export function document() {
  const app = new OpenAPIHono();
  describe(app);
  for (const route of routes) app.openAPIRegistry.registerPath(route);
  return app.getOpenAPI31Document(info);
}
