import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, beforeEach, test } from "node:test";

import type { IndexSearchHit } from "@skywake/engine";
import { sql } from "drizzle-orm";

import { chunks, junk } from "../src/features/links/chunks.ts";
import { headers, prefixed, request } from "../src/features/indexes/providers.ts";
import { route } from "../src/features/indexes/vendors.ts";
import { merged } from "../src/features/links/partial.ts";
import { docxOf, pdfOf, pptxOf, xlsxOf } from "./documents.ts";
import { server, skip, type Server } from "./helpers.ts";

const NS = "/namespaces/prod%2Fapp";
const INDEX = "/indexes/prod%2Ffiles/branches/main";
const TOPICS = ["giraffe", "invoice", "sunset", "dog"];

const state = { embedded: 0, busy: 0, denied: false };

beforeEach(() => {
  state.embedded = 0;
  state.busy = 0;
  state.denied = false;
});

function vectorOf(text: string, dims: number) {
  const lower = text.toLowerCase();
  const vector = [...TOPICS.map((word) => lower.split(word).length - 1), 0.05];
  return [...vector, ...Array(dims - vector.length).fill(0)];
}

function textOf(item: any): string {
  if (typeof item === "string") return item;
  if (item.text !== undefined) return item.text;
  const url: string = item.image ?? item.image_base64;
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString();
}

const provider = createServer((request, response) => {
  let raw = "";
  request.on("data", (part) => (raw += part));
  request.on("end", () => {
    const body = JSON.parse(raw);
    const multimodal = request.url!.endsWith("/multimodalembeddings");
    const inputs: string[] = multimodal
      ? body.inputs.map((one: any) => textOf(one.content[0]))
      : body.input.map(textOf);
    const send = (status: number, answer: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(JSON.stringify(answer));
    };
    if (state.busy > 0) {
      state.busy--;
      return send(429, { error: "slow down" }, { "retry-after": "0" });
    }
    if (state.denied && inputs.some((text) => text.includes("FAILNOW"))) {
      return send(401, { error: "no" });
    }
    if (inputs.some((text) => text.includes("POISON"))) return send(400, { error: "bad input" });
    state.embedded += inputs.length;
    const dims = body.model.includes("multimodal") ? 1024 : 5;
    send(200, {
      data: inputs.map((text, index) => ({ index, embedding: vectorOf(text, dims) })),
    });
  });
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
after(() => provider.close());
const base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;

async function started(overrides = {}) {
  const s = await server({
    embed: { url: base },
    vendors: { voyage: { url: base, key: "voyage-test-key" } },
    ...overrides,
  });
  const { id, key } = await s.ready();
  return { s, id, key };
}

async function link(s: Server, key: string, body: object = {}, status = 200) {
  const done = await s.call("PUT", `${NS}/index`, key, { index: "prod/files", ...body });
  assert.equal(done.status, status, JSON.stringify(done.body));
  return done.body;
}

async function commit(s: Server, key: string, changes: object[]) {
  const done = await s.call("POST", `${NS}/branches/main/commits`, key, {
    message: "change",
    changes,
  });
  assert.equal(done.status, 201, JSON.stringify(done.body));
}

async function status(s: Server, key: string) {
  const done = await s.call("GET", `${NS}/branches/main/index`, key);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return done.body;
}

async function meaning(s: Server, key: string, value: unknown) {
  const done = await s.call("POST", `${INDEX}/query`, key, {
    vector: { column: "embedding", value },
    topK: 5,
    include: ["path", "chunk"],
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return done.body.hits as { id: string; attributes: { path: string; chunk: number } }[];
}

async function words(s: Server, key: string, query: string) {
  const done = await s.call("POST", `${INDEX}/search`, key, { query, include: ["path"] });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return done.body.hits.map((hit: any) => hit.attributes.path).sort();
}

function paragraphs(count: number, last = "") {
  const filler = (i: number) =>
    `Paragraph ${i} talks about weather, roads and many ordinary things in plain words.`.repeat(4);
  return [...Array.from({ length: count }, (_, i) => filler(i)), last].join("\n\n");
}

test("chunks cut at paragraphs, overlap, and cover all of a long text", () => {
  const text = paragraphs(40);
  const pieces = chunks(text);
  assert.ok(pieces.length > 5);
  assert.ok(pieces.every((piece) => piece.length <= 2_000));
  assert.ok(pieces[0]!.includes(pieces[1]!.slice(0, 40)), "chunks overlap");
  assert.equal(chunks("short").length, 1);
  assert.deepEqual(chunks(""), []);
  const long = chunks(`${"word ".repeat(400_000)}last`);
  assert.ok(long.length > 1_000);
  assert.ok(long.at(-1)!.endsWith("last"));
  assert.equal(junk("A".repeat(1_000)), true);
  assert.equal(junk(paragraphs(1)), false);
});

test("partial hits follow whole-word hits, once each", () => {
  const marked = { text: { text: "x", marks: [] } } as unknown as IndexSearchHit["highlights"];
  const hit = (id: string): IndexSearchHit => ({
    id,
    score: 1,
    attributes: {},
    highlights: marked,
  });
  const both = merged([hit("a"), hit("b")], [hit("b"), hit("c")], 10);
  assert.deepEqual(
    both.map((one) => one.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(both[2]!.highlights, {});
  assert.equal(merged([hit("a")], [hit("c")], 1).length, 1);
});

test("every chunk of a big file is searchable by meaning, none go stale", { skip }, async () => {
  const { s, key } = await started();
  const made = await link(s, key, { embed: { model: "tiny" } });
  assert.deepEqual(made.embed, { model: "tiny", dims: 5, images: false });
  await commit(s, key, [
    { path: "docs/zoo.md", text: paragraphs(80, "The giraffe sleeps standing up.") },
    { path: "docs/bills.md", text: "Pay each invoice within thirty days." },
  ]);
  await s.services.syncer.drain();

  const synced = await status(s, key);
  assert.equal(synced.error, null);
  assert.equal(synced.files, 3);
  assert.ok(synced.chunks > 10, `chunks: ${synced.chunks}`);
  const [top] = await meaning(s, key, "where is the giraffe");
  assert.equal(top!.attributes.path, "docs/zoo.md");
  assert.ok(top!.attributes.chunk > 5, "the hit is the chunk deep in the file");
  const paths = (await meaning(s, key, "giraffe")).map((hit) => hit.attributes.path);
  assert.equal(new Set(paths).size, paths.length, "one hit per file");
  assert.deepEqual(await words(s, key, "invoice"), ["docs/bills.md"]);

  await commit(s, key, [{ path: "docs/zoo.md", text: paragraphs(3) }]);
  await s.services.syncer.drain();
  const shrunk = await status(s, key);
  assert.equal(shrunk.files, 3);
  assert.ok(shrunk.chunks < 8, `chunks: ${shrunk.chunks}`);
  assert.notEqual((await meaning(s, key, "giraffe"))[0]!.attributes.path, "docs/zoo.md");

  await commit(s, key, [{ path: "docs", delete: true }]);
  await s.services.syncer.drain();
  const emptied = await status(s, key);
  assert.equal(emptied.files, 1);
  assert.equal(emptied.chunks, 1);
});

test("a busy provider is waited out; a refused file blocks nothing", { skip }, async () => {
  const { s, key } = await started();
  await link(s, key, { embed: { model: "tiny" } });
  state.busy = 2;
  await commit(s, key, [
    { path: "bad.txt", text: "POISON in here" },
    { path: "dog.txt", text: "The dog barks." },
  ]);
  await s.services.syncer.drain();
  const synced = await status(s, key);
  assert.equal(synced.error, null);
  assert.equal(synced.behind, false);
  assert.equal(state.busy, 0);
  assert.deepEqual(synced.skipped, [
    { path: "bad.txt", reason: "the embedding provider refused it, so only its path is embedded" },
  ]);
  assert.equal((await meaning(s, key, "dog"))[0]!.attributes.path, "dog.txt");
  assert.deepEqual(await words(s, key, "poison"), ["bad.txt"]);

  await commit(s, key, [{ path: "bad.txt", text: "fine now" }]);
  await s.services.syncer.drain();
  assert.deepEqual((await status(s, key)).skipped, []);
});

test("a failed first sync resumes where it stopped", { skip }, async () => {
  const { s, id, key } = await started({ bodyLimit: 8 << 20 });
  const big = (word: string) =>
    Array.from({ length: 560 }, (_, i) => `${word} ${i} ${"text ".repeat(340)}`).join("\n\n");
  await commit(s, key, [{ path: "a.md", text: big("alpha") }]);
  await commit(s, key, [{ path: "b.md", text: big("beta FAILNOW") }]);
  state.denied = true;
  await link(s, key, { embed: { model: "tiny" }, maxBytes: 4 << 20 });
  await s.services.syncer.drain();
  const failed = await status(s, key);
  assert.match(failed.error, /401/);
  const first = state.embedded;
  assert.ok(first >= 512, `embedded ${first}`);

  state.denied = false;
  state.embedded = 0;
  await s.services.db.execute(
    sql`UPDATE api.index_link_branches SET due = now() WHERE org = ${id}`,
  );
  await s.services.syncer.drain();
  const resumed = await status(s, key);
  assert.equal(resumed.error, null);
  assert.equal(resumed.files, 3);
  assert.ok(state.embedded <= first, `embedded ${state.embedded} again`);
});

test("an edit re-embeds only the chunk it changed", { skip }, async () => {
  const { s, key } = await started();
  await link(s, key, { embed: { model: "tiny" } });
  await commit(s, key, [{ path: "long.md", text: paragraphs(20, "The end.") }]);
  await s.services.syncer.drain();
  assert.ok(state.embedded > 5);

  state.embedded = 0;
  await commit(s, key, [{ path: "long.md", text: paragraphs(20, "A new ending.") }]);
  await s.services.syncer.drain();
  assert.equal(state.embedded, 1);

  state.embedded = 0;
  await link(s, key, {});
  await s.services.syncer.drain();
  assert.equal((await status(s, key)).error, null);
  assert.equal(state.embedded, 0, "a relink embeds nothing new");
});

test("links embed with the server's model unless told not to", { skip }, async () => {
  const { s, key } = await started({ embedModel: "tiny" });
  const defaults = await s.call("GET", "/index-links/defaults", key);
  assert.deepEqual(defaults.body, { embed: { model: "tiny", images: false } });
  const made = await link(s, key);
  assert.deepEqual(made.embed, { model: "tiny", dims: 5, images: false });
  assert.equal(made.made, true);

  const other = await s.call("POST", "/namespaces", key, { name: "plain" });
  assert.equal(other.status, 201);
  const plain = await s.call("PUT", "/namespaces/plain/index", key, {
    index: "plain-files",
    embed: false,
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.body));
  assert.equal(plain.body.embed, null);
});

test("meaning rebuilds an index the link made, never one it was given", { skip }, async () => {
  const { s, key } = await started();
  await link(s, key, { embed: false });
  await s.services.syncer.drain();
  assert.deepEqual(await words(s, key, "hello"), ["a.txt"]);

  const upgraded = await link(s, key, { embed: { model: "tiny" } });
  assert.deepEqual(upgraded.embed, { model: "tiny", dims: 5, images: false });
  await commit(s, key, [{ path: "dog.txt", text: "The dog barks." }]);
  await s.services.syncer.drain();
  assert.equal((await meaning(s, key, "dog"))[0]!.attributes.path, "dog.txt");
  assert.deepEqual(await words(s, key, "hello"), ["a.txt"]);

  const brought = await s.call("POST", "/indexes", key, {
    name: "mine",
    schema: {
      attributes: [
        { name: "path", type: "string" },
        { name: "text", type: "text" },
      ],
    },
  });
  assert.equal(brought.status, 201, JSON.stringify(brought.body));
  await link(s, key, { index: "mine" });
  const refused = await link(s, key, { index: "mine", embed: { model: "tiny" } }, 409);
  assert.match(refused.error, /not made by this link/);
});

test("words are found inside longer runs of letters", { skip }, async () => {
  const { s, key } = await started();
  await link(s, key, { embed: false });
  await commit(s, key, [{ path: "id.json", text: '{"name":"xsaumyax","id":7}' }]);
  await s.services.syncer.drain();
  assert.deepEqual(await words(s, key, "saumya"), ["id.json"]);
  assert.deepEqual(await words(s, key, "hello"), ["a.txt"]);
});

test("images are embedded beside text, and found by what they show", { skip }, async () => {
  const { s, key } = await started();
  const made = await link(s, key, { embed: { model: "voyage/voyage-multimodal-3.5" } });
  assert.deepEqual(made.embed, {
    model: "voyage/voyage-multimodal-3.5",
    dims: 1024,
    images: true,
  });
  const image = (scene: string) => Buffer.from(`PNG ${scene}`).toString("base64");
  await commit(s, key, [
    { path: "photos/beach.png", base64: image("a sunset over the sea") },
    { path: "photos/park.jpg", base64: image("a dog in the grass") },
    { path: "notes.txt", text: "An invoice to pay." },
  ]);
  await s.services.syncer.drain();
  assert.equal((await status(s, key)).files, 4);
  assert.equal((await meaning(s, key, "sunset"))[0]!.attributes.path, "photos/beach.png");
  assert.equal((await meaning(s, key, "dog"))[0]!.attributes.path, "photos/park.jpg");
  const byImage = await meaning(s, key, { image: `data:image/png;base64,${image("sunset")}` });
  assert.equal(byImage[0]!.attributes.path, "photos/beach.png");
  assert.deepEqual(await words(s, key, "beach"), ["photos/beach.png"]);
});

test("an index names the namespace that keeps it up to date", { skip }, async () => {
  const { s, key } = await started();
  assert.equal((await s.call("GET", "/indexes/prod%2Ffiles/link", key)).status, 404);
  await link(s, key, { embed: false });
  const found = await s.call("GET", "/indexes/prod%2Ffiles/link", key);
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.equal(found.body.namespace, "prod/app");
  assert.equal(found.body.index, "prod/files");
});

test("PDFs and Office files are searched by their text", { skip }, async () => {
  const { s, key } = await started();
  await link(s, key, { embed: { model: "tiny" } });
  const base64 = (bytes: Buffer) => bytes.toString("base64");
  await commit(s, key, [
    { path: "docs/terms.pdf", base64: base64(pdfOf(["Refunds", "A giraffe may return goods."])) },
    { path: "docs/memo.docx", base64: base64(docxOf(["The invoice is due Friday."])) },
    { path: "docs/deck.pptx", base64: base64(pptxOf([["Launch"], ["A sunset over the bay"]])) },
    {
      path: "docs/seats.xlsx",
      base64: base64(
        xlsxOf([
          ["Customer", "Seats"],
          ["Dogwood", 9],
        ]),
      ),
    },
    { path: "docs/old.doc", base64: base64(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 1])) },
    { path: "docs/broken.pdf", base64: base64(Buffer.from("%PDF-1.4 nothing here")) },
  ]);
  await s.services.syncer.drain();
  const synced = await status(s, key);
  assert.equal(synced.error, null);
  assert.deepEqual(synced.skipped, [
    { path: "docs/broken.pdf", reason: "not a readable PDF" },
    { path: "docs/old.doc", reason: "an old Office format; save it as .docx, .pptx or .xlsx" },
  ]);
  assert.equal((await meaning(s, key, "giraffe"))[0]!.attributes.path, "docs/terms.pdf");
  assert.equal((await meaning(s, key, "invoice"))[0]!.attributes.path, "docs/memo.docx");
  assert.equal((await meaning(s, key, "sunset"))[0]!.attributes.path, "docs/deck.pptx");
  assert.deepEqual(await words(s, key, "dogwood"), ["docs/seats.xlsx"]);
});

test("a file larger than one write is searchable to its last line", { skip }, async () => {
  const { s, key } = await started({ bodyLimit: 8 << 20 });
  await link(s, key, { embed: { model: "tiny" } });
  const huge = paragraphs(9_000, "The final line mentions a giraffe.");
  assert.ok(huge.length > 2_500_000);
  await commit(s, key, [{ path: "huge.md", text: huge }]);
  await s.services.syncer.drain();
  const synced = await status(s, key);
  assert.equal(synced.error, null);
  assert.ok(synced.chunks > 1_500, `${synced.chunks} passages`);
  const hit = (await meaning(s, key, "giraffe"))[0]!;
  assert.equal(hit.attributes.path, "huge.md");
  assert.ok(Number(hit.attributes.chunk) > 1_000, `passage ${hit.attributes.chunk}`);

  await commit(s, key, [{ path: "huge.md", text: paragraphs(3, "Now short.") }]);
  await s.services.syncer.drain();
  const left = await s.call("POST", `${INDEX}/order`, key, {
    by: "chunk",
    topK: 10,
    filter: { path: { eq: "huge.md" } },
  });
  assert.equal(left.body.rows.length, 1);
});

test("a link that can't read images says so for each one", { skip }, async () => {
  const { s, key } = await started();
  await link(s, key, { embed: false });
  await commit(s, key, [
    { path: "photos/beach.png", base64: Buffer.from("PNG").toString("base64") },
  ]);
  await s.services.syncer.drain();
  assert.deepEqual((await status(s, key)).skipped, [
    {
      path: "photos/beach.png",
      reason: "an image; search by meaning with a model that reads images to find it",
    },
  ]);
});

test("a model that embeds only text refuses an image", { skip }, async () => {
  const s = await server({ vendors: { openai: { url: base, key: "k" } } });
  const { key } = await s.org();
  const made = await s.call("POST", "/indexes", key, {
    name: "pics",
    schema: {
      vectors: [
        { name: "embedding", dims: 1536, embed: { model: "openai/text-embedding-3-small" } },
      ],
    },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const asked = await s.call("POST", "/indexes/pics/branches/main/query", key, {
    vector: { column: "embedding", value: { image: "data:image/png;base64,AAAA" } },
  });
  assert.equal(asked.status, 400);
  assert.match(asked.body.error, /embeds text only/);
});

test("images go to each vendor's own multimodal endpoint, in its own shape", () => {
  const vendors = { cohere: { key: "c" }, google: { key: "g" } };
  const png = "data:image/png;base64,AAAA";
  const cohere = route("embed", "cohere/embed-v4.0", vendors, undefined, 1024, true);
  assert.equal(cohere.provider.url, "https://api.cohere.com/v2");
  const asked = request(cohere.media, {
    model: cohere.model,
    inputs: ["hi", { image: png }],
    purpose: "query",
    dims: { key: cohere.dims!, value: 1024 },
  });
  assert.equal(asked.path, "/embed");
  assert.deepEqual(asked.body, {
    model: "embed-v4.0",
    input_type: "search_query",
    embedding_types: ["float"],
    inputs: [
      { content: [{ type: "text", text: "hi" }] },
      { content: [{ type: "image_url", image_url: { url: png } }] },
    ],
    output_dimension: 1024,
  });
  assert.deepEqual(asked.vectors({ embeddings: { float: [[1], [2]] } }), [[1], [2]]);

  const google = route("embed", "google/gemini-embedding-2", vendors, undefined, 768, true);
  assert.equal(google.provider.url, "https://generativelanguage.googleapis.com/v1beta");
  const gemini = request(google.media, {
    model: google.model,
    inputs: [{ image: png }],
    purpose: "document",
    dims: { key: google.dims!, value: 768 },
  });
  assert.equal(gemini.path, "/models/gemini-embedding-2:batchEmbedContents");
  assert.deepEqual(gemini.body, {
    requests: [
      {
        model: "models/gemini-embedding-2",
        content: { parts: [{ inline_data: { mime_type: "image/png", data: "AAAA" } }] },
        output_dimensionality: 768,
      },
    ],
  });
  assert.deepEqual(headers(google.media, google.provider), { "x-goog-api-key": "g" });
  assert.deepEqual(gemini.vectors({ embeddings: [{ values: [3] }] }), [[3]]);

  const text = route("embed", "google/gemini-embedding-2", vendors, undefined, undefined, false);
  assert.equal(text.media, "openai");
  const remote = { model: "m", inputs: [{ image: "https://x/y.png" }], purpose: "query" as const };
  assert.throws(() => request("gemini", remote), /data:image/);
});

test("models that want a task prefix get one, on queries and documents alike", () => {
  assert.equal(prefixed("nomic-embed-text", "query", "cats"), "search_query: cats");
  assert.equal(prefixed("nomic-embed-text:v1.5", "document", "cats"), "search_document: cats");
  assert.equal(prefixed("intfloat/e5-large-v2", "document", "cats"), "passage: cats");
  assert.equal(prefixed("openai/text-embedding-3-small", "query", "cats"), "cats");
  assert.deepEqual(prefixed("nomic-embed-text", "query", { image: "x" }), { image: "x" });
});
