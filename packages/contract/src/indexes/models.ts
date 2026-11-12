// The embedding and rerank models the server knows by name. An index may
// name another model; the server's default provider then gets it as written.

export interface EmbeddingModel {
  id: string;
  /** Numbers a vector has unless the column asks for one of `sizes`. */
  dims: number;
  sizes: number[];
  /** Tokens embedded; the rest of a longer text is left out. */
  context: number;
  deprecated?: true;
}

export interface RerankModel {
  id: string;
  context: number;
}

const VOYAGE = [256, 512, 1024, 2048];
const NEMOTRON_1B = [512, 1024, 2048];
const NEMOTRON_8B = [512, 1024, 2048, 4096];

export const EMBEDDING_MODELS: EmbeddingModel[] = [
  { id: "baai/bge-m3", dims: 1024, sizes: [1024], context: 8192 },
  { id: "cohere/embed-v4.0", dims: 1536, sizes: [256, 512, 1024, 1536], context: 128000 },
  { id: "google/gemini-embedding-2", dims: 1536, sizes: [768, 1536, 3072], context: 8192 },
  { id: "nvidia/nemotron-3-embed-1b", dims: 2048, sizes: NEMOTRON_1B, context: 32768 },
  { id: "nvidia/nemotron-3-embed-8b", dims: 4096, sizes: NEMOTRON_8B, context: 32768 },
  { id: "nvidia/nemotron-3.5-embed-1b", dims: 2048, sizes: NEMOTRON_1B, context: 32768 },
  { id: "nvidia/nemotron-3.5-embed-8b", dims: 4096, sizes: NEMOTRON_8B, context: 32768 },
  {
    id: "openai/text-embedding-3-large",
    dims: 3072,
    sizes: [256, 512, 1024, 1536, 3072],
    context: 8191,
  },
  {
    id: "openai/text-embedding-3-small",
    dims: 1536,
    sizes: [256, 512, 768, 1024, 1536],
    context: 8191,
  },
  { id: "openai/text-embedding-ada-002", dims: 1536, sizes: [1536], context: 8191 },
  {
    id: "qwen/qwen3-embedding-0p6b",
    dims: 1024,
    sizes: [256, 384, 512, 768, 1024],
    context: 32768,
  },
  {
    id: "qwen/qwen3-embedding-4b",
    dims: 1024,
    sizes: [512, 1024, 1536, 2048, 2560],
    context: 32768,
  },
  {
    id: "qwen/qwen3-embedding-8b",
    dims: 1024,
    sizes: [512, 1024, 1536, 2048, 3072, 4096],
    context: 32768,
  },
  { id: "voyage/voyage-4", dims: 1024, sizes: VOYAGE, context: 32000 },
  { id: "voyage/voyage-4-large", dims: 1024, sizes: VOYAGE, context: 32000 },
  { id: "voyage/voyage-4-lite", dims: 1024, sizes: VOYAGE, context: 32000 },
  { id: "voyage/voyage-4-nano", dims: 1024, sizes: VOYAGE, context: 32000 },
  { id: "voyage/voyage-code-3", dims: 1024, sizes: VOYAGE, context: 32000 },
  { id: "voyage/voyage-code-4", dims: 1024, sizes: VOYAGE, context: 32000 },
  {
    id: "zeroentropy/zembed-1",
    dims: 1280,
    sizes: [40, 80, 160, 320, 640, 1280, 2560],
    context: 32768,
  },
  { id: "cohere/embed-english-v3.0", dims: 1024, sizes: [1024], context: 512, deprecated: true },
  {
    id: "google/gemini-embedding-001",
    dims: 1536,
    sizes: [768, 1536, 3072],
    context: 2048,
    deprecated: true,
  },
  {
    id: "google/text-embedding-005",
    dims: 768,
    sizes: [256, 512, 768],
    context: 2048,
    deprecated: true,
  },
  { id: "voyage/voyage-3-large", dims: 1024, sizes: VOYAGE, context: 32768, deprecated: true },
  { id: "voyage/voyage-3.5", dims: 1024, sizes: VOYAGE, context: 32768, deprecated: true },
  { id: "voyage/voyage-3.5-lite", dims: 1024, sizes: VOYAGE, context: 32768, deprecated: true },
];

export const RERANK_MODELS: RerankModel[] = [
  { id: "cohere/rerank-v3.5", context: 4096 },
  { id: "voyage/rerank-3", context: 32000 },
  { id: "voyage/rerank-3-lite", context: 32000 },
  { id: "zeroentropy/zerank-2", context: 32768 },
];

export const embeddingModel = (id: string) => EMBEDDING_MODELS.find((model) => model.id === id);
