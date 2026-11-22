import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

import { Models } from "../src/features/indexes/models.ts";

/** An OpenAI-style embeddings server that gives every text `vector` and counts the texts. */
async function embedder(vector: number[]) {
  const texts: string[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (part) => (raw += part));
    request.on("end", () => {
      const inputs: string[] = JSON.parse(raw).input;
      texts.push(...inputs);
      const data = inputs.map((_, index) => ({ index, embedding: vector }));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  after(() => server.close());
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, texts };
}

test("search queries go to the nearby server, and are remembered", async () => {
  const provider = await embedder([1, 0]);
  const nearby = await embedder([0, 1]);
  const models = new Models({
    embed: { url: provider.url },
    embedModel: "tiny",
    queryEmbed: { url: nearby.url },
  });

  assert.deepEqual(await models.embed("tiny", ["refunds"], undefined, "query"), [[0, 1]]);
  assert.deepEqual(await models.embed("tiny", ["refunds"], undefined, "query"), [[0, 1]]);
  assert.deepEqual(nearby.texts, ["refunds"]);

  // Writes, and other models, still go to the provider.
  assert.deepEqual(await models.embed("tiny", ["a file"]), [[1, 0]]);
  assert.deepEqual(await models.embed("other", ["refunds"], undefined, "query"), [[1, 0]]);
  assert.deepEqual(provider.texts, ["a file", "refunds"]);
});

test("a query goes to the provider when the nearby server is down", async () => {
  const provider = await embedder([1, 0]);
  const models = new Models({
    embed: { url: provider.url },
    embedModel: "tiny",
    queryEmbed: { url: "http://127.0.0.1:9/v1" },
  });
  assert.deepEqual(await models.embed("tiny", ["refunds"], undefined, "query"), [[1, 0]]);
  assert.deepEqual(provider.texts, ["refunds"]);
});
