import { indexes } from "@skywake/contract";

import type { Provider, Vendors } from "../../config.ts";
import { badRequest } from "../../http/errors.ts";

interface Vendor {
  url?: string;
  rerankUrl?: string;
  dims?: string;
  top?: string;
  names?: Record<string, string>;
}

const DEEPINFRA = "https://api.deepinfra.com/v1/openai";

const VENDORS: Record<string, Vendor> = {
  openai: { url: "https://api.openai.com/v1", dims: "dimensions" },
  voyage: {
    url: "https://api.voyageai.com/v1",
    rerankUrl: "https://api.voyageai.com/v1",
    dims: "output_dimension",
    top: "top_k",
  },
  cohere: {
    url: "https://api.cohere.com/compatibility/v1",
    rerankUrl: "https://api.cohere.com/v2",
    dims: "dimensions",
  },
  google: { url: "https://generativelanguage.googleapis.com/v1beta/openai", dims: "dimensions" },
  nvidia: { url: "https://integrate.api.nvidia.com/v1" },
  baai: { url: DEEPINFRA, names: { "baai/bge-m3": "BAAI/bge-m3" } },
  qwen: {
    url: DEEPINFRA,
    dims: "dimensions",
    names: {
      "qwen/qwen3-embedding-0p6b": "Qwen/Qwen3-Embedding-0.6B",
      "qwen/qwen3-embedding-4b": "Qwen/Qwen3-Embedding-4B",
      "qwen/qwen3-embedding-8b": "Qwen/Qwen3-Embedding-8B",
    },
  },
  zeroentropy: {},
};

export interface Route {
  provider: Provider;
  model: string;
  dims?: string;
  top: string;
}

export function route(
  kind: "embed" | "rerank",
  model: string,
  vendors: Vendors,
  fallback: Provider | undefined,
  dims?: number,
): Route {
  const known =
    kind === "embed"
      ? indexes.embeddingModel(model)
      : indexes.RERANK_MODELS.find((one) => one.id === model);
  const name = model.split("/")[0]!;
  const fewer = known && "dims" in known && dims !== undefined && dims !== known.dims;
  const own = known && vendors[name];
  if (own) {
    const vendor = VENDORS[name] ?? {};
    const url = kind === "embed" ? (own.url ?? vendor.url) : (own.rerankUrl ?? vendor.rerankUrl);
    if (!url) throw badRequest(`provider \`${name}\` needs a URL on this server for \`${model}\``);
    return {
      provider: { url, key: own.key },
      model: vendor.names?.[model] ?? model.slice(name.length + 1),
      dims: fewer ? vendor.dims : undefined,
      top: vendor.top ?? "top_n",
    };
  }
  if (fallback)
    return { provider: fallback, model, dims: fewer ? "dimensions" : undefined, top: "top_n" };
  if (known)
    throw badRequest(`model \`${model}\` needs provider \`${name}\` set up on this server`);
  throw badRequest(
    `${kind === "embed" ? "embeddings are" : "reranking is"} not set up on this server`,
  );
}
