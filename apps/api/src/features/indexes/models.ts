import type { Provider, Vendors } from "../../config.ts";
import { HttpError } from "../../http/errors.ts";
import type { Input } from "./embeddings.ts";
import { route } from "./vendors.ts";

const EMBED_BATCH = 128;
const TIMEOUT_MS = 30_000;

export interface Ranked {
  index: number;
  score: number;
}

export class Models {
  readonly #embed: Provider | undefined;
  readonly #rerank: Provider | undefined;
  readonly #vendors: Vendors;

  constructor(providers: { embed?: Provider; rerank?: Provider; vendors?: Vendors }) {
    this.#embed = providers.embed;
    this.#rerank = providers.rerank;
    this.#vendors = providers.vendors ?? {};
  }

  async embed(model: string, inputs: Input[], dims?: number): Promise<number[][]> {
    const to = route("embed", model, this.#vendors, this.#embed, dims);
    const fewer = to.dims && dims !== undefined ? { [to.dims]: dims } : {};
    const vectors: number[][] = [];
    for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
      const batch = inputs.slice(i, i + EMBED_BATCH);
      const input = batch.every((one) => typeof one === "string")
        ? batch
        : batch.map((one) => (typeof one === "string" ? { text: one } : one));
      const body = { model: to.model, input, ...fewer };
      const answer = await call("embedding", to.provider, "/embeddings", body);
      const data = (answer as { data?: unknown }).data;
      if (!Array.isArray(data) || data.length !== input.length) {
        throw unavailable("embedding", "did not give one vector per text");
      }
      const sorted = data.every((item) => typeof item?.index === "number")
        ? [...data].sort((a, b) => a.index - b.index)
        : data;
      for (const item of sorted) {
        const vector: unknown = item?.embedding;
        if (!Array.isArray(vector) || !vector.every((n) => typeof n === "number")) {
          throw unavailable("embedding", "gave a vector that is not numbers");
        }
        vectors.push(vector);
      }
    }
    return vectors;
  }

  async rerank(
    model: string,
    query: string,
    documents: string[],
    topN?: number,
  ): Promise<Ranked[]> {
    const to = route("rerank", model, this.#vendors, this.#rerank);
    const answer = await call("rerank", to.provider, "/rerank", {
      model: to.model,
      query,
      documents,
      ...(topN === undefined ? {} : { [to.top]: topN }),
    });
    const { results, data } = answer as { results?: unknown; data?: unknown };
    const list = results ?? data;
    if (!Array.isArray(list)) throw unavailable("rerank", "gave no results");
    const ranked = list.map((item): Ranked => {
      const index: unknown = item?.index;
      const score: unknown = item?.relevance_score;
      if (
        typeof index !== "number" ||
        typeof score !== "number" ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= documents.length
      ) {
        throw unavailable("rerank", "gave a result that is not an index and a score");
      }
      return { index, score };
    });
    return ranked.sort((a, b) => b.score - a.score);
  }
}

async function call(kind: string, provider: Provider, path: string, body: object) {
  let response: Response;
  try {
    response = await fetch(provider.url + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(provider.key ? { authorization: `Bearer ${provider.key}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw unavailable(kind, "could not be reached");
  }
  if (!response.ok) {
    const shown = [400, 404, 422].includes(response.status)
      ? `: ${(await response.text().catch(() => "")).slice(0, 300)}`
      : "";
    throw unavailable(kind, `answered ${response.status}${shown}`);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw unavailable(kind, "did not answer JSON");
  }
}

const unavailable = (kind: string, what: string) =>
  new HttpError(503, `the ${kind} provider ${what}`);
