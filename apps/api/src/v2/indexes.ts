import type { z } from "@hono/zod-openapi";
import { indexes as v1, qualify, v2 } from "@skywake/contract";

import { madeIndexes } from "../features/links/queries.ts";
import type { V2 } from "./app.ts";
import { Failure, invalid } from "./errors.ts";
import { segment } from "./forward.ts";
import { pageAfter, pageOf } from "./pages.ts";
import { aggregate, count, filterOf, query } from "./query.ts";
import { docOf, fieldsOf, firstSchema, type Row, rowOf } from "./rows.ts";
import { orMissing, type Scope } from "./scope.ts";

const routes = v2.indexes;
type Schema = v1.IndexSchema;
type Index = z.output<typeof v1.Index> & { stats?: { rows: number; bytes: number } | null };
type Branch = { name: string; forked_from: string | null; created: string };
type Version = { version: string; time: string; rows: number };

const MAIN = "main";
const VERSION = /^[0-9a-f]{64}$/;

export const branchOf = (branch: {
  name: string;
  forked_from: string | null;
  created: string;
}) => ({
  name: branch.name,
  from: branch.forked_from,
  created: branch.created,
});

const versionOf = (version: Version) => ({
  id: version.version,
  created: version.time,
  rows: version.rows,
});

export class Indexes {
  readonly scope: Scope;
  readonly name: string;

  constructor(scope: Scope, name: string) {
    this.scope = scope;
    this.name = name;
  }

  get path() {
    return this.scope.path("index", this.name);
  }

  branch(branch = MAIN) {
    return `${this.path}/branches/${segment(branch)}`;
  }

  async index(): Promise<Index> {
    return orMissing(this.scope, "index", this.name, this.scope.v1.get<Index>(this.path));
  }

  async info() {
    const index = await this.index();
    const branches = await this.scope.v1.get<Branch[]>(`${this.path}/branches`);
    return {
      name: this.name,
      region: index.region,
      created: index.created,
      schema: index.schema,
      rows: index.stats?.rows ?? null,
      bytes: index.stats?.bytes ?? null,
      read_only: index.read_only,
      retention_days: index.retention_days,
      branches: branches.map((b) => b.name),
    };
  }

  async create(schema: Schema, region?: string) {
    await this.scope.notTaken("index", this.name);
    await this.scope.v1.post("/indexes", { name: this.scope.full(this.name), schema, region });
  }

  async embedding(asked?: { model: string } | false) {
    if (asked === false) return null;
    const { models } = this.scope.c.var.services;
    const model = asked?.model ?? models.linkModel;
    if (!model) return null;
    return { model, dims: await models.dims(model) };
  }

  async schemaFor(rows: Row[], branch: string): Promise<Schema> {
    let schema: Schema;
    try {
      schema = (await this.scope.v1.get<Index>(this.path)).schema;
    } catch (error) {
      if (!(error instanceof Failure && error.status === 404)) throw error;
      if (branch !== MAIN) throw await this.scope.notFound("index", this.name);
      await this.create(firstSchema(rows, await this.embedding())).catch((error: unknown) => {
        if (
          !(error instanceof Failure && error.status === 409 && error.details.hint === undefined)
        ) {
          throw error;
        }
      });
      schema = (await this.scope.v1.get<Index>(this.path)).schema;
    }
    return this.grown(schema, rows);
  }

  async grown(schema: Schema, rows: Row[]): Promise<Schema> {
    const found = fieldsOf(rows, schema);
    const vector = [...found.vectors.keys()][0];
    if (vector !== undefined) {
      throw invalid(
        "is a new vector field; an index's vectors are set when it is made",
        `rows[].${vector}`,
        "make a new index, or copy this one with the new field",
      );
    }
    if (found.attributes.length === 0) return schema;
    await this.scope.v1.patch(this.path, { attributes: found.attributes });
    return { ...schema, attributes: [...schema.attributes, ...found.attributes] };
  }

  async upsert(input: Record<string, unknown> | Record<string, unknown>[], branch = MAIN) {
    const rows = (Array.isArray(input) ? input : [input]).map(
      (row) => ({ ...row, id: row.id ?? crypto.randomUUID() }) as Row,
    );
    const schema = await this.schemaFor(rows, branch);
    for (let i = 0; i < rows.length; i += v1.BATCH_MAX) {
      const documents = rows.slice(i, i + v1.BATCH_MAX).map((row) => docOf(schema, row));
      await this.scope.v1.post(`${this.branch(branch)}/documents`, { documents });
    }
    return { ids: rows.map((row) => row.id), count: rows.length };
  }

  async write(body: Record<string, unknown>, branch = MAIN) {
    return orMissing(
      this.scope,
      "index",
      this.name,
      this.scope.v1.post<{ upserted: number; patched: number; deleted: number }>(
        `${this.branch(branch)}/write`,
        body,
      ),
    );
  }
}

const ids = (asked: { id?: string | number; ids?: (string | number)[] }) =>
  asked.ids ?? (asked.id === undefined ? undefined : [asked.id]);

export function registerIndexes(api: V2) {
  const open = async (c: Parameters<Parameters<V2["openapi"]>[1]>[0], name: string) =>
    new Indexes(await c.var.scope(), name);

  api.openapi(routes.listIndexes, async (c) => {
    const scope = await c.var.scope();
    const [all, hidden] = await Promise.all([
      scope.v1.get<Index[]>("/indexes"),
      madeIndexes(scope.c.var.services.db, scope.org),
    ]);
    const mine = all.flatMap((index) => {
      const name = hidden.has(index.name) ? null : scope.mine(index.name);
      return name === null ? [] : [{ name, region: index.region, created: index.created }];
    });
    return c.json(
      pageOf(mine, (index) => index.name, c.req.valid("query")),
      200,
    );
  });

  api.openapi(routes.createIndex, async (c) => {
    const asked = c.req.valid("json");
    const index = await open(c, asked.name);
    const embed = await index.embedding(asked.embed);
    const schema = asked.schema ?? null;
    if (!schema) {
      throw invalid(
        "is needed to make an empty index",
        "schema",
        "or skip this call: the first upsert makes the index and its schema",
      );
    }
    if (embed && !schema.vectors.length) {
      const text = schema.attributes.find((a) => a.type === "text" || a.type === "string");
      if (text) {
        schema.vectors.push({
          name: "_meaning",
          dims: embed.dims,
          metric: "cosine",
          embed: { model: embed.model, from: text.name },
        });
      }
    }
    await index.create(schema, asked.region);
    return c.json(await index.info(), 201);
  });

  api.openapi(routes.getIndex, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    return c.json(await index.info(), 200);
  });

  api.openapi(routes.configureIndex, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    await orMissing(
      index.scope,
      "index",
      c.req.valid("param").index,
      index.scope.v1.patch(index.path, c.req.valid("json")),
    );
    return c.json(await index.info(), 200);
  });

  api.openapi(routes.destroyIndex, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    await index.index();
    await index.scope.v1.delete(index.path);
    return c.body(null, 204);
  });

  api.openapi(routes.upsertRows, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    const { branch } = c.req.valid("query");
    return c.json(await index.upsert(c.req.valid("json"), branch), 200);
  });

  api.openapi(routes.updateRows, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    const { branch } = c.req.valid("query");
    const asked = c.req.valid("json");
    const schema = (await index.index()).schema;
    await index.grown(schema, [{ id: 0, ...asked.fields }]);
    const chosen = ids(asked);
    const body = chosen
      ? { patches: chosen.map((id) => ({ id, attributes: asked.fields })) }
      : { patchBy: { filter: filterOf(asked.filter), attributes: asked.fields } };
    const done = await index.write(body, branch);
    return c.json({ count: done.patched }, 200);
  });

  api.openapi(routes.deleteRows, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    const { branch } = c.req.valid("query");
    const asked = c.req.valid("json");
    const chosen = ids(asked);
    const done = await index.write(
      chosen ? { deletes: chosen } : { deleteBy: filterOf(asked.filter) },
      branch,
    );
    return c.json({ count: done.deleted }, 200);
  });

  api.openapi(routes.getRow, async (c) => {
    const { index: name, id } = c.req.valid("param");
    const index = await open(c, name);
    const { branch } = c.req.valid("query");
    try {
      const doc = await index.scope.v1.get<{
        id: string | number;
        attributes?: Record<string, unknown>;
      }>(`${index.branch(branch)}/documents/${segment(id)}`);
      return c.json(rowOf(doc), 200);
    } catch (error) {
      if (error instanceof Failure && error.status === 404) {
        await index.index();
        throw new Failure(404, `row \`${id}\` does not exist`, { hint: null });
      }
      throw error;
    }
  });

  api.openapi(routes.listRows, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    const { branch, limit, cursor } = c.req.valid("query");
    const page = await orMissing(
      index.scope,
      "index",
      c.req.valid("param").index,
      index.scope.v1.get<{
        documents: { id: string | number; attributes: Record<string, unknown> }[];
        next: string | null;
      }>(`${index.branch(branch)}/documents`, { limit: limit ?? 100, cursor }),
    );
    return c.json({ data: page.documents.map(rowOf), next: page.next }, 200);
  });

  api.openapi(routes.queryIndex, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    return c.json({ data: await query(index, c.req.valid("json")), next: null }, 200);
  });

  api.openapi(routes.countRows, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    const { filter, branch } = c.req.valid("json");
    return c.json({ count: await count(index, filter, branch) }, 200);
  });

  api.openapi(routes.aggregateRows, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    return c.json({ data: await aggregate(index, c.req.valid("json")), next: null }, 200);
  });

  api.openapi(routes.listIndexBranches, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    await index.index();
    const all = await index.scope.v1.get<Branch[]>(`${index.path}/branches`);
    return c.json(
      pageOf(all.map(branchOf), (b) => b.name, c.req.valid("query")),
      200,
    );
  });

  api.openapi(routes.forkIndex, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    const { name, from, at } = c.req.valid("json");
    const made = await orMissing(
      index.scope,
      "index",
      c.req.valid("param").index,
      index.scope.v1.post<Branch>(`${index.path}/branches`, { name, from: from ?? MAIN, at }),
    );
    return c.json(branchOf(made), 201);
  });

  api.openapi(routes.destroyIndexBranch, async (c) => {
    const { index: name, branch } = c.req.valid("param");
    const index = await open(c, name);
    await orMissing(index.scope, "index", name, index.scope.v1.delete(index.branch(branch)));
    return c.body(null, 204);
  });

  api.openapi(routes.mergeIndex, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    const { from, into } = c.req.valid("json");
    const merged = await orMissing(
      index.scope,
      "index",
      c.req.valid("param").index,
      index.scope.v1.post<{ rows: number }>(`${index.branch(into)}/merge`, { from }),
    );
    return c.json({ rows: merged.rows }, 200);
  });

  api.openapi(routes.listVersions, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    const { branch, limit, cursor } = c.req.valid("query");
    const size = Math.min(limit ?? 20, v1.VERSIONS_MAX);
    const versions = await orMissing(
      index.scope,
      "index",
      c.req.valid("param").index,
      index.scope.v1.get<Version[]>(`${index.branch(branch)}/versions`, {
        limit: size,
        after: cursor,
      }),
    );
    return c.json(
      pageAfter(versions.map(versionOf), size, (v) => v.id),
      200,
    );
  });

  api.openapi(routes.restoreIndex, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    const { to, branch } = c.req.valid("json");
    const version = VERSION.test(to) ? to : await versionAt(index, to, branch);
    const made = await orMissing(
      index.scope,
      "index",
      c.req.valid("param").index,
      index.scope.v1.post<Version>(`${index.branch(branch)}/restore`, { version }),
    );
    return c.json(versionOf(made), 200);
  });

  api.openapi(routes.copyIndex, async (c) => {
    const index = await open(c, c.req.valid("param").index);
    const { name, environment } = c.req.valid("json");
    const scope = index.scope;
    const target = environment ?? scope.environment;
    if (target === scope.environment) await scope.notTaken("index", name);
    const made = await orMissing(
      scope,
      "index",
      c.req.valid("param").index,
      scope.v1.post<Index>(`${index.path}/copy`, { name: qualify(target, name) }),
    );
    return c.json({ name, region: made.region, created: made.created }, 201);
  });
}

async function versionAt(index: Indexes, time: string, branch?: string) {
  const at = Date.parse(time);
  if (Number.isNaN(at))
    throw invalid(
      "is not a version id or a time",
      "to",
      "give a version from GET /versions, or a time such as 2026-01-31T12:00:00Z",
    );
  let after: string | undefined;
  for (;;) {
    const page = await index.scope.v1.get<Version[]>(`${index.branch(branch)}/versions`, {
      limit: v1.VERSIONS_MAX,
      after,
    });
    const found = page.find((v) => Date.parse(v.time) <= at);
    if (found) return found.version;
    if (page.length < v1.VERSIONS_MAX) break;
    after = page[page.length - 1]!.version;
  }
  throw invalid("is before the oldest version kept", "to");
}
