/** The most documents one upsert takes, and ids one delete takes. */
export const BATCH_MAX = 1000;

/** The most bytes of one upsert. */
export const UPSERT_BYTES_MAX = 32 * 1024 * 1024;

/** The most numbers in one vector. */
export const DIMS_MAX = 4096;

/** The most hits one query returns. */
export const TOP_K_MAX = 1000;

/** The most characters of one text search. */
export const SEARCH_MAX = 4096;

/** The most searches one hybrid query fuses. */
export const HYBRID_MAX = 16;

/** The most documents one page of a scan returns. */
export const SCAN_MAX = 1000;

/** The most hits one query may skip, for pages. */
export const OFFSET_MAX = 10_000;

/** The most requests one multi-query runs. */
export const MULTI_MAX = 16;

/** The most groups one aggregation returns. */
export const GROUPS_MAX = 1000;

/** The most shards an index is split over. */
export const SHARDS_MAX = 256;

/** The most replicas a pinned index has. */
export const REPLICAS_MAX = 8;

/** The most characters of one text to embed or rerank by. */
export const TEXT_MAX = 32 * 1024;

/** The longest image given to embed: an https URL or a base64 data URL. */
export const IMAGE_MAX = 8 * 1024 * 1024;

/** The most days of usage one call returns. */
export const USAGE_DAYS_MAX = 90;

/** Filter keywords, so no attribute may take these names. */
export const FILTER_WORDS = ["and", "or", "not"] as const;

/** Names no attribute may take: the filter keywords, and `id`, which filters by id. */
export const RESERVED_NAMES = [...FILTER_WORDS, "id"] as const;
export const FILTER_OPS = [
  "eq",
  "ne",
  "in",
  "not_in",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains_all",
  "contains_any",
  "glob",
  "iglob",
  "regex",
  "fuzzy",
  "exists",
] as const;

export const MEASURES = ["count", "sum", "avg", "min", "max"] as const;
export const TEXT_OPS = ["phrase", "prefix", "contains_all_tokens", "contains_any_token"] as const;

export const VERSIONS_MAX = 100;
