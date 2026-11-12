import { indexes as routes } from "@skywake/contract";
import type { DocId } from "@skywake/engine";

import type { Feature } from "../../http/context.ts";
import { Texts } from "./embeddings.ts";
import { writable } from "./lifecycle.ts";
import * as rules from "./rules/index.ts";

export const indexWritesFeature: Feature = {
  register(api) {
    api.openapi(routes.upsertDocuments, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { documents: docs, returnAffectedIds } = c.req.valid("json");
      const written = docs.map((doc, i) => ({
        values: doc.attributes ?? {},
        path: `documents[${i}].attributes`,
      }));
      const { index } = await writable(c, name, branch, written, docs, "documents");
      const texts = new Texts();
      const documents = rules.documents(index.schema, docs, texts);
      const bill = c.var.services.usage.bill(index);
      await bill.admit("writes");
      await texts.embed(c.var.services.models, bill);
      let upserted: DocId[] | undefined;
      if (returnAffectedIds) {
        upserted = (await index.store.write(branch, { upserts: documents, returnAffectedIds }))
          .upsertedIds;
      } else {
        await index.store.upsert(branch, documents);
      }
      bill.count("writes", documents.length);
      bill.wrote(Buffer.byteLength(JSON.stringify(docs)));
      const count = documents.length;
      return c.json({ count, upserted_ids: upserted, billing: bill.counts }, 200);
    });

    api.openapi(routes.deleteDocuments, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await writable(c, name, branch);
      const { ids, returnAffectedIds } = c.req.valid("json");
      rules.checkIds(index.schema, ids, "ids");
      // Only ids that were there count, and only they are billed.
      const done = await index.store.write(branch, {
        deletes: ids,
        returnAffectedIds,
        exactDeletes: true,
      });
      const bill = c.var.services.usage.bill(index);
      bill.count("deletes", done.deleted);
      return c.json(
        { count: done.deleted, deleted_ids: done.deletedIds, billing: bill.counts },
        200,
      );
    });

    api.openapi(routes.writeDocuments, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const body = c.req.valid("json");
      const upserts = body.upserts ?? [];
      const written = [
        ...upserts.map((doc, i) => ({
          values: doc.attributes ?? {},
          path: `upserts[${i}].attributes`,
        })),
        ...(body.patches ?? []).map((patch, i) => ({
          values: patch.attributes,
          path: `patches[${i}].attributes`,
        })),
        ...(body.patchBy ? [{ values: body.patchBy.attributes, path: "patchBy.attributes" }] : []),
      ];
      const { index } = await writable(c, name, branch, written, upserts, "upserts");
      const texts = new Texts();
      const write = rules.write(index.schema, body, texts);
      const bill = c.var.services.usage.bill(index);
      await bill.admit("writes");
      await texts.embed(c.var.services.models, bill);
      const { upsertedIds, patchedIds, deletedIds, missing, ...counts } = await index.store.write(
        branch,
        { ...write, exactDeletes: true },
      );
      void missing;
      bill.count("writes", counts.upserted + counts.patched);
      bill.count("deletes", counts.deleted);
      bill.wrote(Buffer.byteLength(JSON.stringify(body)));
      const ids = { upserted_ids: upsertedIds, patched_ids: patchedIds, deleted_ids: deletedIds };
      return c.json({ ...counts, ...ids, billing: bill.counts }, 200);
    });
  },
};
