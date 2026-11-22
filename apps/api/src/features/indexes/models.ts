import { indexes } from "@skywake/contract";

import type { Provider, Vendors } from "../../config.ts";
import { HttpError } from "../../http/errors.ts";
import { byIndex, headers, type Input, isImage, type Media, type Purpose, request } from "./providers.ts";
import { route } from "./vendors.ts";

const BATCH: Record<Media, number> = { openai: 128, voyage: 128, cohere: 96, gemini: 6 };
const IN_FLIGHT = 4;
const TIMEOUT_MS = 30_000;
const TRIES = 5;
const BACKOFF_MS = 500;
const WAIT_MAX_MS = 20_000;
const REFUSED = [400, 404, 413, 422];
/** A nearby query server answers in well under this, or the provider takes over. */
const NEARBY_MS = 2_000;
/** Search queries remembered, so asking again skips the model. */
const QUERIES_KEPT = 2_000;

export interface Ranked {
  index: number;
  score: number;
}

export class Refused extends HttpError {
  constructor(message: string) {
    super(503, message);
  }
}

export class Models {
  readonly #embed: Provider | undefined;
  readonly #rerank: Provider | undefined;
  readonly #vendors: Vendors;
  readonly #sizes = new Map<string, number>();
  readonly #nearby: Provider | undefined;
  readonly #queries = new Map<string, number[]>();
  readonly linkModel: string | undefined;

  constructor(providers: {
    embed?: Provider;
    rerank?: Provider;
    vendors?: Vendors;
    embedModel?: string;
    queryEmbed?: Provider;
  }) {
    this.#nearby = providers.queryEmbed;
    this.#embed = providers.embed;
    this.#rerank = providers.rerank;
    this.#vendors = providers.vendors ?? {};
    this.linkModel = providers.embedModel;
  }

  async dims(model: string): Promise<number> {
    const known = indexes.embeddingModel(model)?.dims ?? this.#sizes.get(model);
    if (known) return known;
    const [probe] = await this.embed(model, ["dims"]);
    this.#sizes.set(model, probe!.length);
    return probe!.length;
  }

  async embed(
    model: string,
    inputs: Input[],
    dims?: number,
    purpose: Purpose = "document",
  ): Promise<number[][]> {
    const [text] = inputs;
    if (purpose !== "query" || inputs.length !== 1 || typeof text !== "string") {
      return this.#remote(model, inputs, dims, purpose);
    }
    const key = `${model}\n${dims ?? ""}\n${text}`;
    const kept = this.#queries.get(key);
    if (kept) {
      this.#queries.delete(key);
      this.#queries.set(key, kept);
      return [kept];
    }
    const vector =
      (await this.#close(model, text, dims)) ??
      (await this.#remote(model, inputs, dims, purpose))[0]!;
    this.#queries.set(key, vector);
    if (this.#queries.size > QUERIES_KEPT) {
      this.#queries.delete(this.#queries.keys().next().value!);
    }
    return [vector];
  }

  /** The default model's vector for a query from the nearby server, or null to ask the provider. */
  async #close(model: string, text: string, dims?: number): Promise<number[] | null> {
    const known = indexes.embeddingModel(model);
    const full = dims === undefined || (known && "dims" in known && dims === known.dims);
    if (!this.#nearby || model !== this.linkModel || !full) return null;
    try {
      const response = await fetch(`${this.#nearby.url}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: [text] }),
        signal: AbortSignal.timeout(NEARBY_MS),
      });
      if (!response.ok) return null;
      const answer = (await response.json()) as { data?: unknown };
      const [vector] = vectorsOf(byIndex(answer.data, "embedding"), 1);
      return vector!;
    } catch {
      return null;
    }
  }

  async #remote(
    model: string,
    inputs: Input[],
    dims: number | undefined,
    purpose: Purpose,
  ): Promise<number[][]> {
    const to = route("embed", model, this.#vendors, this.#embed, dims, inputs.some(isImage));
    const size = BATCH[to.media];
    const batches: Input[][] = [];
    for (let i = 0; i < inputs.length; i += size) batches.push(inputs.slice(i, i + size));
    const done = await inParallel(batches, IN_FLIGHT, async (batch) => {
      const asked = request(to.media, {
        model: to.model,
        inputs: batch,
        purpose,
        dims: to.dims && dims !== undefined ? { key: to.dims, value: dims } : undefined,
      });
      const auth = headers(to.media, to.provider);
      const answer = await call("embedding", to.provider, asked.path, asked.body, auth);
      return vectorsOf(asked.vectors(answer), batch.length);
    });
    return done.flat();
  }

  async embedEach(
    model: string,
    inputs: Input[],
    dims?: number,
    purpose: Purpose = "document",
  ): Promise<(number[] | null)[]> {
    try {
      return await this.embed(model, inputs, dims, purpose);
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      if (inputs.length === 1) return [null];
      const half = Math.ceil(inputs.length / 2);
      const [first, second] = await Promise.all([
        this.embedEach(model, inputs.slice(0, half), dims, purpose),
        this.embedEach(model, inputs.slice(half), dims, purpose),
      ]);
      return [...first, ...second];
    }
  }

  async rerank(
    model: string,
    query: string,
    documents: string[],
    topN?: number,
  ): Promise<Ranked[]> {
    const to = route("rerank", model, this.#vendors, this.#rerank);
    const answer = await call(
      "rerank",
      to.provider,
      "/rerank",
      { model: to.model, query, documents, ...(topN === undefined ? {} : { [to.top]: topN }) },
      headers("openai", to.provider),
    );
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

function vectorsOf(list: unknown[], count: number): number[][] {
  if (list.length !== count) throw unavailable("embedding", "did not give one vector per text");
  return list.map((vector) => {
    if (!Array.isArray(vector) || !vector.every((n) => typeof n === "number")) {
      throw unavailable("embedding", "gave a vector that is not numbers");
    }
    return vector;
  });
}

async function inParallel<T, R>(items: T[], limit: number, each: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      results[at] = await each(items[at]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function call(
  kind: string,
  provider: Provider,
  path: string,
  body: object,
  auth: Record<string, string>,
) {
  const started = Date.now();
  for (let tried = 1; ; tried++) {
    const outcome = await once(kind, provider.url + path, body, auth);
    if (!("retry" in outcome)) return outcome.answer;
    const wait = outcome.after ?? BACKOFF_MS * 2 ** (tried - 1) * (0.5 + Math.random());
    if (tried >= TRIES || Date.now() - started + wait > TIMEOUT_MS) throw outcome.error;
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, WAIT_MAX_MS)));
  }
}

type Outcome = { answer: unknown } | { retry: true; error: HttpError; after?: number };

async function once(kind: string, url: string, body: object, auth: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { retry: true, error: unavailable(kind, "could not be reached") } as Outcome;
  }
  if (response.ok) {
    try {
      return { answer: (await response.json()) as unknown } as Outcome;
    } catch {
      throw unavailable(kind, "did not answer JSON");
    }
  }
  if (REFUSED.includes(response.status)) {
    const text = (await response.text().catch(() => "")).slice(0, 300);
    throw new Refused(`the ${kind} provider answered ${response.status}: ${text}`);
  }
  const error = unavailable(kind, `answered ${response.status}`);
  if (response.status !== 408 && response.status !== 429 && response.status < 500) throw error;
  return { retry: true, error, after: retryAfter(response.headers.get("retry-after")) } as Outcome;
}

function retryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

const unavailable = (kind: string, what: string) =>
  new HttpError(503, `the ${kind} provider ${what}`);

