import { indexes as routes } from "@skywake/contract";

import type { Feature } from "../../http/context.ts";
import { notFound } from "../../http/errors.ts";
import { indexFor } from "../../http/request.ts";
import { start } from "./jobs.ts";
import * as indexes from "./queries.ts";
import { measureRecall } from "./recall.ts";

export const indexOperationsFeature: Feature = {
  register(api) {
    api.openapi(routes.buildIndex, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "write");
      const operation = await start(c, index, branch, "build", () => index.store.build(branch));
      return c.json(operation, 202);
    });

    api.openapi(routes.warmIndex, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const operation = await start(c, index, branch, "warm", () => index.store.warm(branch));
      return c.json(operation, 202);
    });

    api.openapi(routes.collectIndex, async (c) => {
      const { index } = await indexFor(c, c.req.valid("param").index, "admin");
      // The engine takes a missing key, not null, as "keep every version".
      const retentionDays = index.retentionDays ?? undefined;
      const operation = await start(c, index, null, "collect", () =>
        index.store.collect({ retentionDays }).then(() => {}),
      );
      return c.json(operation, 202);
    });

    api.openapi(routes.getIndexOperation, async (c) => {
      const { index: name, operation: id } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const found = await indexes.findOperation(c.var.services.db, index.org, index.name, id);
      if (!found) throw notFound(`operation \`${id}\``);
      return c.json(indexes.shownOperation(found), 200);
    });

    api.openapi(routes.checkRecall, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      return c.json(await measureRecall(c, index, branch, c.req.valid("json")), 200);
    });
  },
};
