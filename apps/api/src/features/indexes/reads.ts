import { indexes as routes } from "@skywake/contract";
import type { DocId, IndexDoc } from "@skywake/engine";

import type { Feature } from "../../http/context.ts";
import { badRequest, notFound } from "../../http/errors.ts";
import { indexFor } from "../../http/request.ts";
import { answer } from "./answer.ts";
import { Texts } from "./embeddings.ts";
import { kept, reranked, withField } from "./rerank.ts";
import * as rules from "./rules/index.ts";
import type { Bill } from "./usage.ts";

const SCAN_DEFAULT = 100;
const { GROUPS_MAX } = routes;

const cursorOf = (id: DocId) => Buffer.from(JSON.stringify(id)).toString("base64url");

function afterOf(cursor: string | undefined): DocId | undefined {
  if (cursor === undefined) return undefined;
  try {
    const id: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (typeof id === "string" || typeof id === "number") return id;
  } catch {}
  throw badRequest("`cursor` is not one this server gave");
}

export const indexReadsFeature: Feature = {
  register(api) {
    api.openapi(routes.orderDocuments, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const bill = c.var.services.usage.bill(index);
      const body = c.req.valid("json");
      const order = rules.order(index.schema, body);
      const { results, ...meta } = await answer(index, branch, [{ order }], body.consistency, bill);
      return c.json({ rows: results[0]!.order!, ...meta }, 200);
    });

    api.openapi(routes.rankDocuments, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const bill = c.var.services.usage.bill(index);
      const body = c.req.valid("json");
      const rank = rules.rank(index.schema, body);
      const { results, ...meta } = await answer(index, branch, [{ rank }], body.consistency, bill);
      return c.json({ hits: results[0]!.rank!, ...meta }, 200);
    });

    api.openapi(routes.aggregateDocuments, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const bill = c.var.services.usage.bill(index);
      const body = c.req.valid("json");
      const aggregate = rules.aggregate(index.schema, body);
      const { results, ...meta } = await answer(
        index,
        branch,
        [{ aggregate }],
        body.consistency,
        bill,
      );
      const groups = fewGroups(results[0]!.aggregate!);
      return c.json({ groups, ...meta }, 200);
    });

    api.openapi(routes.multiQuery, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const bill = c.var.services.usage.bill(index);
      const texts = new Texts();
      const body = c.req.valid("json");
      const requests = rules.multi(index.schema, body, texts);
      await texts.embed(c.var.services.models, bill);
      const { results, ...meta } = await answer(index, branch, requests, body.consistency, bill);
      for (const result of results) {
        if (result.aggregate) fewGroups(result.aggregate);
      }
      return c.json({ results, ...meta }, 200);
    });

    api.openapi(routes.exportDocuments, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { format } = c.req.valid("query");
      const { index } = await indexFor(c, name, "read");
      const bill = c.var.services.usage.bill(index);
      if (format === "parquet") {
        const file = await index.store.exportParquet(branch);
        bill.count("queries");
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const bytes = await file.next();
            if (!bytes) return controller.close();
            controller.enqueue(new Uint8Array(bytes));
          },
        });
        return c.body(body, 200, { "content-type": "application/vnd.apache.parquet" }) as never;
      }
      const batches = await index.store.export(branch);
      bill.count("queries");
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const docs = await batches.next();
          if (!docs) return controller.close();
          const lines = docs.map((doc) => JSON.stringify(shown(doc)) + "\n").join("");
          controller.enqueue(encoder.encode(lines));
        },
      });
      return c.body(body, 200, { "content-type": "application/x-ndjson" }) as never;
    });

    api.openapi(routes.queryIndex, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const bill = c.var.services.usage.bill(index);
      const body = c.req.valid("json");
      const texts = new Texts();
      const query = rules.query(index.schema, body, texts);
      const plan = body.rerank && rules.rerank(index.schema, body.rerank, text(body.vector.value));
      if (plan) query.include = withField(query.include, plan.field);
      await texts.embed(c.var.services.models, bill);
      const { results, ...meta } = await answer(index, branch, [{ query }], body.consistency, bill);
      const hits = results[0]!.query!;
      if (!plan) return c.json({ hits, ...meta }, 200);
      const ordered = await reranked(
        c.var.services.models,
        bill,
        plan,
        hits,
        kept(body, plan.field),
      );
      return c.json({ hits: ordered, ...meta }, 200);
    });

    api.openapi(routes.searchIndex, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const bill = c.var.services.usage.bill(index);
      const body = c.req.valid("json");
      const search = rules.search(index.schema, body);
      const plan = body.rerank && rules.rerank(index.schema, body.rerank, body.query);
      if (plan) search.include = withField(search.include, plan.field);
      const { results, ...meta } = await answer(
        index,
        branch,
        [{ search }],
        body.consistency,
        bill,
      );
      const hits = results[0]!.search!;
      if (!plan) return c.json({ hits, ...meta }, 200);
      const ordered = await reranked(
        c.var.services.models,
        bill,
        plan,
        hits,
        kept(body, plan.field),
      );
      return c.json({ hits: ordered, ...meta }, 200);
    });

    api.openapi(routes.hybridQuery, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const bill = c.var.services.usage.bill(index);
      const body = c.req.valid("json");
      const texts = new Texts();
      const hybrid = rules.hybrid(index.schema, body, texts);
      const searches = Object.values(body.searches);
      const words =
        searches.map((one) => ("query" in one ? one.query : undefined)).find(Boolean) ??
        searches.map((one) => ("vector" in one ? text(one.vector.value) : undefined)).find(Boolean);
      const plan = body.rerank && rules.rerank(index.schema, body.rerank, words);
      if (plan) {
        for (const one of hybrid.searches) {
          const search = one.vector ?? one.text!;
          search.include = withField(search.include, plan.field);
        }
      }
      await texts.embed(c.var.services.models, bill);
      const { results, ...meta } = await answer(
        index,
        branch,
        [{ hybrid }],
        body.consistency,
        bill,
      );
      const hits = results[0]!.hybrid!;
      if (!plan) return c.json({ hits, ...meta }, 200);
      const keep = searches.some((one) => kept(one, plan.field));
      const ordered = await reranked(c.var.services.models, bill, plan, hits, keep);
      return c.json({ hits: ordered, ...meta }, 200);
    });

    api.openapi(routes.listDocuments, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const { limit = SCAN_DEFAULT, cursor } = c.req.valid("query");
      const found = await index.store.scan(branch, afterOf(cursor), limit + 1);
      const documents = found.slice(0, limit).map(shown);
      const next = found.length > limit ? cursorOf(documents.at(-1)!.id) : null;
      return c.json({ documents, next }, 200);
    });

    api.openapi(routes.getDocument, async (c) => {
      const { index: name, branch, id } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const uuids = index.schema.id === "uuid";
      if (uuids && !rules.isUuid(id)) throw notFound(`document \`${id}\``);
      const number = !uuids && /^\d{1,15}$/.test(id);
      const asNumber = number ? await index.store.get(branch, Number(id)) : null;
      const found = asNumber ?? (await index.store.get(branch, id));
      if (!found) throw notFound(`document \`${id}\``);
      return c.json(shown(found), 200);
    });
  },
};

const text = (value: routes.VectorValue) => (typeof value === "string" ? value : undefined);

const shown = (doc: IndexDoc) => ({ ...doc, attributes: doc.attributes ?? {} });

function fewGroups<T>(groups: T[]) {
  if (groups.length > GROUPS_MAX) {
    throw badRequest(`more than ${GROUPS_MAX} groups; filter or group by fewer attributes`);
  }
  return groups;
}
