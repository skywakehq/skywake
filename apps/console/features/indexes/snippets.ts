// A query as code to paste: the TypeScript SDK, the Python SDK, or curl.

export type Lang = "ts" | "python" | "curl";

export type QueryBody = {
  vector: { column: string; value: number[] };
  topK: number;
  recall?: number;
  probe?: number;
  filter?: unknown;
  include?: string[];
};

export type SearchBody = {
  query: string;
  topK: number;
  fields?: string[];
  boosts?: Record<string, number>;
  k1?: number;
  b?: number;
  filter?: unknown;
  include?: string[];
  highlight?: string[];
};

export type HybridBody = {
  searches: Record<string, QueryBody | SearchBody>;
  topK: number;
  fuse?: { k?: number; weights?: Record<string, number> };
};

/** Each request the playground makes, by its route. */
export type Request =
  | { route: "query"; body: QueryBody }
  | { route: "search"; body: SearchBody }
  | { route: "hybrid"; body: HybridBody };

const json = (value: unknown) => JSON.stringify(value);

/** Python literals: JSON with True, False and None. */
const python = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/\btrue\b/g, "True")
    .replace(/\bfalse\b/g, "False");

/** Python keyword arguments, leaving out what is not set. */
const kwargs = (pairs: [string, unknown][]) =>
  pairs
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${python(value)}`);

function pythonCall(request: Request): string {
  if (request.route === "query") {
    const q = request.body;
    return `query(${[
      json(q.vector.column),
      python(q.vector.value),
      ...kwargs([
        ["top_k", q.topK],
        ["recall", q.recall],
        ["probe", q.probe],
        ["filter", q.filter],
        ["include", q.include?.length ? q.include : undefined],
      ]),
    ].join(", ")})`;
  }
  if (request.route === "search") {
    const s = request.body;
    return `search(${[
      json(s.query),
      ...kwargs([
        ["top_k", s.topK],
        ["fields", s.fields],
        ["boosts", s.boosts],
        ["k1", s.k1],
        ["b", s.b],
        ["filter", s.filter],
        ["include", s.include?.length ? s.include : undefined],
        ["highlight", s.highlight?.length ? s.highlight : undefined],
      ]),
    ].join(", ")})`;
  }
  const h = request.body;
  return `hybrid(${[
    python(h.searches),
    ...kwargs([
      ["top_k", h.topK],
      ["k", h.fuse?.k],
      ["weights", h.fuse?.weights],
    ]),
  ].join(", ")})`;
}

export function snippet(lang: Lang, index: string, branch: string, request: Request, api: string) {
  const at = branch === "main" ? "" : `.at(${json(branch)})`;
  if (lang === "ts") {
    return [
      `import { Skywake } from "@skywake/sdk";`,
      ``,
      `const sky = new Skywake({ url: ${json(api)}, key: process.env.SKYWAKE_KEY! });`,
      `const hits = await sky.index(${json(index)})${at}.${request.route}(${JSON.stringify(request.body, null, 2)});`,
    ].join("\n");
  }
  if (lang === "python") {
    return [
      `import os`,
      `from skywake import Skywake`,
      ``,
      `sky = Skywake(${json(api)}, os.environ["SKYWAKE_KEY"])`,
      `hits = sky.index(${json(index)})${at}.${pythonCall(request)}`,
    ].join("\n");
  }
  const path = `${api}/v1/indexes/${encodeURIComponent(index)}/branches/${encodeURIComponent(branch)}/${request.route}`;
  return [
    `curl -X POST '${path}' \\`,
    `  -H "Authorization: Bearer $SKYWAKE_KEY" \\`,
    `  -H 'content-type: application/json' \\`,
    `  -d '${JSON.stringify(request.body).replace(/'/g, "'\\''")}'`,
  ].join("\n");
}
