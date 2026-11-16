import { DEFAULT, envOf, nameInEnv } from "@/lib/names";

export type Lang = "ts" | "python" | "curl";

export type Mode = "auto" | "meaning" | "keywords";

/** A query as the v2 SDKs and HTTP API take it. */
export type Query = {
  text?: string;
  vector?: number[];
  mode?: Mode;
  filter?: unknown;
  limit?: number;
};

type Style = "ts" | "python";

const DEFAULT_URL = "https://api.skywake.dev";
const DEFAULT_LIMIT = 10;
const MAIN = "main";
const WIDTH = 64;

const json = (value: unknown) => JSON.stringify(value);

const keyOf = (key: string, style: Style) =>
  style === "ts" && /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);

function literal(value: unknown, style: Style, depth = 0): string {
  if (value === null || value === undefined) return style === "python" ? "None" : "null";
  if (typeof value === "boolean")
    return style === "python" ? (value ? "True" : "False") : `${value}`;
  if (typeof value !== "object") return JSON.stringify(value);
  const list = Array.isArray(value);
  const items = list
    ? value.map((item) => literal(item, style, depth + 1))
    : Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => `${keyOf(key, style)}: ${literal(item, style, depth + 1)}`);
  const [open, close] = list ? ["[", "]"] : ["{", "}"];
  if (!items.length) return open + close;
  const gap = list || style === "python" ? "" : " ";
  const inline = `${open}${gap}${items.join(", ")}${gap}${close}`;
  if (!inline.includes("\n") && inline.length + depth * 2 <= WIDTH) return inline;
  const pad = "  ".repeat(depth + 1);
  return `${open}\n${items.map((item) => `${pad}${item},`).join("\n")}\n${"  ".repeat(depth)}${close}`;
}

/** A call on one line, or with one argument a line when it is long. */
function callOf(head: string, args: (depth: number) => string[]) {
  const inline = `${head}(${args(0).join(", ")})`;
  if (!inline.includes("\n") && inline.length <= WIDTH + 16) return inline;
  return `${head}(\n${args(1)
    .map((arg) => `  ${arg},`)
    .join("\n")}\n)`;
}

const options = ({ vector, mode, filter, limit }: Query) =>
  Object.entries({
    vector,
    mode,
    filter,
    limit: limit === DEFAULT_LIMIT ? undefined : limit,
  }).filter(([, value]) => value !== undefined);

function typescript(api: string, index: string, branch: string, query: Query) {
  const settings = api === DEFAULT_URL ? "" : `{ url: ${json(api)} }`;
  const on = branch === MAIN ? "" : `, { branch: ${json(branch)} }`;
  const given = options(query);
  return [
    `import { Skywake } from "skywake";`,
    ``,
    `const sky = new Skywake(${settings});`,
    `const index = sky.index(${json(index)}${on});`,
    `const hits = await ${callOf("index.query", (depth) => [
      ...(query.text === undefined ? [] : [json(query.text)]),
      ...(given.length ? [literal(Object.fromEntries(given), "ts", depth)] : []),
    ])};`,
  ].join("\n");
}

function python(api: string, index: string, branch: string, query: Query) {
  const settings = api === DEFAULT_URL ? "" : `url=${json(api)}`;
  const on = branch === MAIN ? "" : `, branch=${json(branch)}`;
  return [
    `from skywake import Skywake`,
    ``,
    `sky = Skywake(${settings})`,
    `index = sky.index(${json(index)}${on})`,
    `hits = ${callOf("index.query", (depth) => [
      ...(query.text === undefined ? [] : [json(query.text)]),
      ...options(query).map(([name, value]) => `${name}=${literal(value, "python", depth)}`),
    ])}`,
  ].join("\n");
}

function curl(api: string, index: string, env: string, branch: string, query: Query) {
  const body = {
    text: query.text,
    ...Object.fromEntries(options(query)),
    ...(branch === MAIN ? {} : { branch }),
  };
  return [
    `curl -X POST '${api}/v2/indexes/${encodeURIComponent(index)}/query' \\`,
    `  -H "Authorization: Bearer $SKYWAKE_API_KEY" \\`,
    ...(env === DEFAULT ? [] : [`  -H 'Skywake-Environment: ${env}' \\`]),
    `  -H 'content-type: application/json' \\`,
    `  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`,
  ].join("\n");
}

/** A query as code to paste: the TypeScript SDK, the Python SDK, or curl. */
export function snippet(lang: Lang, index: string, branch: string, query: Query, api: string) {
  const name = nameInEnv(index);
  if (lang === "ts") return typescript(api, name, branch, query);
  if (lang === "python") return python(api, name, branch, query);
  return curl(api, name, envOf(index), branch, query);
}
