import type { Provider } from "../../config.ts";
import { HttpError } from "../../http/errors.ts";

export type Input = string | { image: string };
export type Purpose = "document" | "query";
export type Media = "openai" | "voyage" | "cohere" | "gemini";

export interface Request {
  path: string;
  body: object;
  headers?: Record<string, string>;
  vectors: (answer: unknown) => unknown[];
}

interface Asked {
  model: string;
  inputs: Input[];
  purpose: Purpose;
  dims?: { key: string; value: number };
}

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/s;

export const isImage = (input: Input): input is { image: string } => typeof input !== "string";

export function request(media: Media, asked: Asked): Request {
  if (media === "voyage") return voyage(asked);
  if (media === "cohere") return cohere(asked);
  if (media === "gemini") return gemini(asked);
  return openai(asked);
}

const PREFIXES: [RegExp, Record<Purpose, string>][] = [
  [/nomic-embed-text/, { query: "search_query: ", document: "search_document: " }],
  [/(^|\/)(multilingual-)?e5-/, { query: "query: ", document: "passage: " }],
  [
    /mxbai-embed-large|bge-(small|base|large)-en/,
    { query: "Represent this sentence for searching relevant passages: ", document: "" },
  ],
];

export function prefixed(model: string, purpose: Purpose, input: Input): Input {
  if (isImage(input)) return input;
  const found = PREFIXES.find(([pattern]) => pattern.test(model));
  return found ? found[1][purpose] + input : input;
}

function openai({ model, inputs, dims, purpose }: Asked): Request {
  const texts = inputs.map((one) => prefixed(model, purpose, one));
  const input = texts.every((one) => typeof one === "string")
    ? texts
    : texts.map((one) => (typeof one === "string" ? { text: one } : one));
  return {
    path: "/embeddings",
    body: { model, input, ...(dims ? { [dims.key]: dims.value } : {}) },
    vectors: (answer) => byIndex((answer as { data?: unknown }).data, "embedding"),
  };
}

function voyage({ model, inputs, purpose }: Asked): Request {
  const content = (one: Input) =>
    !isImage(one)
      ? { type: "text", text: one }
      : one.image.startsWith("data:")
        ? { type: "image_base64", image_base64: one.image }
        : { type: "image_url", image_url: one.image };
  return {
    path: "/multimodalembeddings",
    body: {
      model,
      input_type: purpose,
      inputs: inputs.map((one) => ({ content: [content(one)] })),
    },
    vectors: (answer) => byIndex((answer as { data?: unknown }).data, "embedding"),
  };
}

function cohere({ model, inputs, purpose, dims }: Asked): Request {
  const content = (one: Input) =>
    isImage(one)
      ? { type: "image_url", image_url: { url: dataUrl(one.image, "cohere") } }
      : { type: "text", text: one };
  return {
    path: "/embed",
    body: {
      model,
      input_type: purpose === "query" ? "search_query" : "search_document",
      embedding_types: ["float"],
      inputs: inputs.map((one) => ({ content: [content(one)] })),
      ...(dims ? { output_dimension: dims.value } : {}),
    },
    vectors: (answer) => {
      const list = (answer as { embeddings?: { float?: unknown } }).embeddings?.float;
      return Array.isArray(list) ? list : [];
    },
  };
}

function gemini({ model, inputs, dims }: Asked): Request {
  const part = (one: Input) => {
    if (!isImage(one)) return { text: one };
    const [, mime, data] = DATA_URL.exec(dataUrl(one.image, "gemini"))!;
    return { inline_data: { mime_type: mime, data } };
  };
  const name = `models/${model}`;
  return {
    path: `/${name}:batchEmbedContents`,
    body: {
      requests: inputs.map((one) => ({
        model: name,
        content: { parts: [part(one)] },
        ...(dims ? { output_dimensionality: dims.value } : {}),
      })),
    },
    vectors: (answer) => {
      const list = (answer as { embeddings?: { values?: unknown }[] }).embeddings;
      return Array.isArray(list) ? list.map((one) => one?.values) : [];
    },
  };
}

export function headers(media: Media, provider: Provider): Record<string, string> {
  if (!provider.key) return {};
  return media === "gemini"
    ? { "x-goog-api-key": provider.key }
    : { authorization: `Bearer ${provider.key}` };
}

function dataUrl(image: string, vendor: string) {
  if (DATA_URL.test(image)) return image;
  throw new HttpError(400, `${vendor} models take images as base64 \`data:image/...\` URLs`);
}

function byIndex(data: unknown, field: string): unknown[] {
  if (!Array.isArray(data)) return [];
  const sorted = data.every((item) => typeof item?.index === "number")
    ? [...data].sort((a, b) => a.index - b.index)
    : data;
  return sorted.map((item) => item?.[field]);
}
