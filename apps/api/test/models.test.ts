import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

import { server, skip } from "./helpers.ts";

const KEY = "provider-key-for-tests";

/** Vectors the fake model gives; any other text is far from all of them. */
const VECTORS: Record<string, number[]> = {
  "a cat sleeps": [0, 0],
  "a dog barks": [1, 0],
  "a car drives": [5, 0],
  kitten: [0.1, 0],
  puppy: [1.1, 0],
};

interface Seen {
  path: string;
  authorization: string | undefined;
  body: any;
}

// A fake provider with an OpenAI-style `/v1/embeddings` and a Cohere-style
// `/v1/rerank`. Model `wide` gives 3 numbers; the reranker likes longer texts.
const seen: Seen[] = [];
const provider = createServer((request, response) => {
  let text = "";
  request.on("data", (chunk) => (text += chunk));
  request.on("end", () => {
    const body = JSON.parse(text);
    seen.push({ path: request.url!, authorization: request.headers.authorization, body });
    let answer: unknown;
    if (request.url!.endsWith("/embeddings")) {
      // Multimodal inputs come as `{text}` or `{image}`.
      const keyOf = (input: any): string =>
        typeof input === "string" ? input : (input.text ?? input.image);
      const data = (body.input as unknown[]).map((input, index) => ({
        index,
        embedding: body.output_dimension
          ? Array(body.output_dimension).fill(0)
          : body.model.includes("/")
            ? Array(1536).fill(0)
            : body.model === "wide"
              ? [0, 0, 0]
              : (VECTORS[keyOf(input)] ?? [9, 9]),
      }));
      // Backwards, to check that the API puts them in order by `index`.
      answer = { data: data.reverse() };
    } else {
      const results = (body.documents as string[]).map((document, index) => ({
        index,
        relevance_score: document.length / 100,
      }));
      results.sort((a, b) => b.relevance_score - a.relevance_score);
      answer = { results: results.slice(0, body.top_n) };
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(answer));
  });
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
after(() => provider.close());
const base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;

const SCHEMA = {
  vectors: [{ name: "embedding", dims: 2, metric: "euclidean", embed: { model: "tiny" } }],
  attributes: [
    { name: "body", type: "text" },
    { name: "tag", type: "string" },
    { name: "price", type: "number" },
  ],
};

const DOCS = [
  { id: 1, vectors: { embedding: "a cat sleeps" }, attributes: { body: "cat", tag: "pet" } },
  { id: 2, vectors: { embedding: "a dog barks" }, attributes: { body: "a big dog", tag: "pet" } },
  { id: 3, vectors: { embedding: [5, 0] }, attributes: { body: "a car on the road", price: 3 } },
];

const MAIN = "/indexes/things/branches/main";

async function made(withProviders = true) {
  const s = await server(
    withProviders ? { embed: { url: base, key: KEY }, rerank: { url: base, key: KEY } } : {},
  );
  const { key } = await s.org();
  const created = await s.call("POST", "/indexes", key, { name: "things", schema: SCHEMA });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const call = (path: string, body: unknown) => s.call("POST", `${MAIN}${path}`, key, body);
  return { s, key, call };
}

test("vectors given as text are embedded on upsert and on query", { skip }, async () => {
  seen.length = 0;
  const { s, key, call } = await made();
  assert.deepEqual((await s.call("GET", "/indexes/things", key)).body.schema.vectors[0].embed, {
    model: "tiny",
  });

  const wrote = await call("/documents", { documents: DOCS });
  assert.equal(wrote.status, 200, JSON.stringify(wrote.body));
  assert.deepEqual(seen, [
    {
      path: "/v1/embeddings",
      authorization: `Bearer ${KEY}`,
      body: { model: "tiny", input: ["a cat sleeps", "a dog barks"] },
    },
  ]);
  assert.deepEqual((await s.call("GET", `${MAIN}/documents/2`, key)).body.vectors, {
    embedding: [1, 0],
  });

  const near = await call("/query", { vector: { column: "embedding", value: "puppy" }, topK: 2 });
  assert.equal(near.status, 200, JSON.stringify(near.body));
  assert.deepEqual(
    near.body.hits.map((hit: any) => hit.id),
    [2, 1],
  );

  // Inside a hybrid query too.
  const fused = await call("/hybrid", {
    searches: { meaning: { vector: { column: "embedding", value: "kitten" }, topK: 1 } },
  });
  assert.equal(fused.status, 200, JSON.stringify(fused.body));
  assert.deepEqual(
    fused.body.hits.map((hit: any) => hit.id),
    [1],
  );

  // Many texts go in batches.
  seen.length = 0;
  const many = Array.from({ length: 130 }, (_, id) => ({
    id: 100 + id,
    vectors: { embedding: `text ${id}` },
  }));
  assert.equal((await call("/documents", { documents: many })).status, 200);
  assert.deepEqual(
    seen.map((one) => one.body.input.length),
    [128, 2],
  );

  // An image goes with the texts of its batch, each as an object.
  seen.length = 0;
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const pictured = await call("/documents", {
    documents: [
      { id: 7, vectors: { embedding: { image } } },
      { id: 8, vectors: { embedding: "a dog barks" } },
    ],
  });
  assert.equal(pictured.status, 200, JSON.stringify(pictured.body));
  assert.deepEqual(seen[0]!.body.input, [{ image }, { text: "a dog barks" }]);
  const notImage = await call("/documents", {
    documents: [{ id: 9, vectors: { embedding: { image: "file:///etc/passwd" } } }],
  });
  assert.equal(notImage.status, 400, JSON.stringify(notImage.body));

  const usage = await s.call("GET", "/indexes/things/usage?days=1", key);
  assert.equal(usage.body.days[0].embeddings, 2 + 1 + 1 + 130 + 2);
});

test("a model that gives the wrong number of dimensions is refused", { skip }, async () => {
  const s = await server({ embed: { url: base } });
  const { key } = await s.org();
  const schema = { vectors: [{ name: "v", dims: 2, embed: { model: "wide" } }] };
  assert.equal((await s.call("POST", "/indexes", key, { name: "wide", schema })).status, 201);
  const wrote = await s.call("POST", "/indexes/wide/branches/main/documents", key, {
    documents: [{ id: 1, vectors: { v: "hello" } }],
  });
  assert.equal(wrote.status, 400, JSON.stringify(wrote.body));
  assert.equal(wrote.body.path, "documents[0].vectors.v");
  assert.match(wrote.body.error, /model `wide` gives 3 numbers, but the column has 2/);
  const asked = await s.call("POST", "/indexes/wide/branches/main/query", key, {
    vector: { column: "v", value: "hello" },
  });
  assert.equal(asked.status, 400);
  assert.equal(asked.body.path, "vector.value");
});

test("text is refused without a provider or an embed model", { skip }, async () => {
  const { s, key, call } = await made(false);
  const wrote = await call("/documents", { documents: DOCS });
  assert.equal(wrote.status, 400);
  assert.equal(wrote.body.error, "embeddings are not set up on this server");
  const asked = await call("/query", { vector: { column: "embedding", value: "puppy" } });
  assert.equal(asked.body.error, "embeddings are not set up on this server");

  assert.equal((await call("/documents", { documents: [DOCS[2]] })).status, 200);
  const reranked = await call("/search", {
    query: "car",
    rerank: { model: "rr", field: "body" },
  });
  assert.equal(reranked.status, 400);
  assert.equal(reranked.body.error, "reranking is not set up on this server");

  // A column without `embed` takes only numbers, whatever the server can do.
  const schema = { vectors: [{ name: "v", dims: 2 }] };
  assert.equal((await s.call("POST", "/indexes", key, { name: "plain", schema })).status, 201);
  const plain = await s.call("POST", "/indexes/plain/branches/main/documents", key, {
    documents: [{ id: 1, vectors: { v: "hello" } }],
  });
  assert.equal(plain.status, 400);
  assert.equal(plain.body.path, "documents[0].vectors.v");
  assert.match(plain.body.error, /has no `embed` model/);
});

test("rerank orders hits by the model and gives each its score", { skip }, async () => {
  const { s, key, call } = await made();
  assert.equal((await call("/documents", { documents: DOCS })).status, 200);
  seen.length = 0;

  // BM25 puts the short `cat` first; the fake reranker likes longer texts.
  const found = await call("/search", {
    query: "cat dog car",
    rerank: { model: "rr", field: "body", topN: 2 },
  });
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.deepEqual(found.body.billing, { queries: 1, reranks: 1 });
  assert.deepEqual(
    found.body.hits.map((hit: any) => [hit.id, hit.rerank_score, hit.attributes]),
    [
      [3, 0.17, {}],
      [2, 0.09, {}],
    ],
  );
  assert.equal(seen[0]!.path, "/v1/rerank");
  assert.equal(seen[0]!.body.query, "cat dog car");
  assert.equal(seen[0]!.body.top_n, 2);
  assert.deepEqual([...seen[0]!.body.documents].sort(), ["a big dog", "a car on the road", "cat"]);

  // The field comes back only when `include` names it.
  const near = await call("/query", {
    vector: { column: "embedding", value: [0, 0] },
    include: ["body", "tag"],
    rerank: { model: "rr", field: "body", query: "dogs" },
  });
  assert.equal(near.status, 200, JSON.stringify(near.body));
  assert.deepEqual(
    near.body.hits.map((hit: any) => [hit.id, hit.attributes.body]),
    [
      [3, "a car on the road"],
      [2, "a big dog"],
      [1, "cat"],
    ],
  );

  const pathOf = async (body: object) => {
    const answer = await call("/query", body);
    assert.equal(answer.status, 400, JSON.stringify(answer.body));
    return answer.body.path;
  };
  const vector = { column: "embedding", value: [0, 0] };
  assert.equal(await pathOf({ vector, rerank: { model: "rr", field: "body" } }), "rerank.query");
  assert.equal(
    await pathOf({ vector, rerank: { model: "rr", field: "price", query: "x" } }),
    "rerank.field",
  );

  const usage = await s.call("GET", "/indexes/things/usage?days=1", key);
  assert.equal(usage.body.days[0].reranks, 2);
});

test("rerank orders the fused hits of a hybrid query", { skip }, async () => {
  const { call } = await made();
  assert.equal((await call("/documents", { documents: DOCS })).status, 200);
  seen.length = 0;

  const fused = await call("/hybrid", {
    searches: {
      meaning: { vector: { column: "embedding", value: "a cat sleeps" }, topK: 3 },
      words: { query: "cat", topK: 3 },
    },
    rerank: { model: "rr", field: "body" },
  });
  assert.equal(fused.status, 200, JSON.stringify(fused.body));
  assert.deepEqual(
    fused.body.hits.map((hit: any) => hit.id),
    [3, 2, 1],
  );
  assert.ok(fused.body.hits.every((hit: any) => typeof hit.rerank_score === "number"));
  assert.ok(fused.body.hits.every((hit: any) => !("body" in hit.attributes)));
  // It ranks by the words searched for.
  assert.equal(seen.find((one) => one.path === "/v1/rerank")!.body.query, "cat");

  const inner = await call("/hybrid", {
    searches: { words: { query: "cat", rerank: { model: "rr", field: "body" } } },
  });
  assert.equal(inner.status, 400);
  assert.equal(inner.body.path, "searches.words.rerank");
});

test("a vector embedded from an attribute is filled on upsert", { skip }, async () => {
  const s = await server({ embed: { url: base, key: KEY } });
  const { key } = await s.org();
  const created = await s.call("POST", "/indexes", key, {
    name: "notes",
    schema: {
      vectors: [
        { name: "meaning", dims: 2, metric: "euclidean", embed: { model: "tiny", from: "body" } },
      ],
      attributes: [{ name: "body", type: "text" }],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const NOTES = "/indexes/notes/branches/main";
  const documents = [
    { id: 1, attributes: { body: "a cat sleeps" } },
    { id: 2, vectors: { meaning: [5, 0] }, attributes: { body: "a dog barks" } },
  ];
  const wrote = await s.call("POST", `${NOTES}/documents`, key, { documents });
  assert.equal(wrote.status, 200, JSON.stringify(wrote.body));
  assert.deepEqual((await s.call("GET", `${NOTES}/documents/1`, key)).body.vectors, {
    meaning: [0, 0],
  });
  assert.deepEqual((await s.call("GET", `${NOTES}/documents/2`, key)).body.vectors, {
    meaning: [5, 0],
  });
  const empty = await s.call("POST", `${NOTES}/documents`, key, { documents: [{ id: 3 }] });
  assert.equal(empty.status, 400);
  assert.match(empty.body.message ?? empty.body.error ?? "", /body/);
  const patched = await s.call("POST", `${NOTES}/write`, key, {
    patches: [{ id: 1, attributes: { body: "a dog barks" } }],
  });
  assert.equal(patched.status, 400);
  assert.equal(patched.body.path, "patches[0].attributes.body");

  const bad = await s.call("POST", "/indexes", key, {
    name: "bad",
    schema: {
      vectors: [{ name: "v", dims: 2, embed: { model: "tiny", from: "nothing" } }],
    },
  });
  assert.equal(bad.status, 400);
});

test("catalog models go to their vendor, by the vendor's name and size", { skip }, async () => {
  seen.length = 0;
  // `base` stands in for Voyage; the default provider is a gateway at the same place.
  const s = await server({
    embed: { url: `${base}/gateway`, key: "gateway-key" },
    vendors: { voyage: { url: base, rerankUrl: base, key: "voyage-key" } },
  });
  const { key } = await s.org();
  const make = (name: string, model: string, dims: number) =>
    s.call("POST", "/indexes", key, {
      name,
      schema: {
        vectors: [{ name: "v", dims, embed: { model } }],
        attributes: [{ name: "body", type: "text" }],
      },
    });

  const wrong = await make("wrong", "voyage/voyage-4", 300);
  assert.equal(wrong.status, 400);
  assert.match(JSON.stringify(wrong.body), /256, 512, 1024, 2048/);

  assert.equal((await make("small", "voyage/voyage-4", 256)).status, 201);
  const written = await s.call("POST", "/indexes/small/branches/main/documents", key, {
    documents: [{ id: 1, vectors: { v: "a cat sleeps" }, attributes: { body: "a cat sleeps" } }],
  });
  assert.equal(written.status, 200, JSON.stringify(written.body));
  assert.deepEqual(seen.at(-1), {
    path: "/v1/embeddings",
    authorization: "Bearer voyage-key",
    body: { model: "voyage-4", input: ["a cat sleeps"], output_dimension: 256 },
  });

  // A catalog model whose vendor has no key goes to the gateway, named in full.
  assert.equal((await make("other", "openai/text-embedding-3-small", 1536)).status, 201);
  await s.call("POST", "/indexes/other/branches/main/documents", key, {
    documents: [{ id: 1, vectors: { v: "a cat sleeps" } }],
  });
  assert.deepEqual(seen.at(-1), {
    path: "/v1/gateway/embeddings",
    authorization: "Bearer gateway-key",
    body: { model: "openai/text-embedding-3-small", input: ["a cat sleeps"] },
  });

  const ranked = await s.call("POST", "/indexes/small/branches/main/search", key, {
    query: "cat",
    rerank: { model: "voyage/rerank-3", field: "body", topN: 1 },
  });
  assert.equal(ranked.status, 200, JSON.stringify(ranked.body));
  assert.deepEqual(seen.at(-1), {
    path: "/v1/rerank",
    authorization: "Bearer voyage-key",
    body: { model: "rerank-3", query: "cat", documents: ["a cat sleeps"], top_k: 1 },
  });

  const bare = await server({ vendors: {} });
  const owner = await bare.org();
  await bare.call("POST", "/indexes", owner.key, {
    name: "bare",
    schema: {
      vectors: [{ name: "v", dims: 1536, embed: { model: "openai/text-embedding-3-small" } }],
    },
  });
  const refused = await bare.call("POST", "/indexes/bare/branches/main/documents", owner.key, {
    documents: [{ id: 1, vectors: { v: "a cat" } }],
  });
  assert.equal(refused.status, 400);
  assert.equal(
    refused.body.error,
    "model `openai/text-embedding-3-small` needs provider `openai` set up on this server",
  );
});
