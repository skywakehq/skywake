export const PREFIX = "/compat";

export const ROUTES = [
  { method: "GET", path: "/v1/namespaces", action: "compat.listNamespaces" },
  { method: "POST", path: "/v2/namespaces/:namespace", action: "compat.write" },
  { method: "DELETE", path: "/v2/namespaces/:namespace", action: "compat.deleteNamespace" },
  { method: "POST", path: "/v2/namespaces/:namespace/async", action: "compat.startCopy" },
  {
    method: "GET",
    path: "/v1/namespaces/:namespace/operations/:token",
    action: "compat.pollCopy",
  },
  { method: "POST", path: "/v2/namespaces/:namespace/query", action: "compat.query" },
  { method: "POST", path: "/v2/namespaces/:namespace/explain_query", action: "compat.explain" },
  { method: "GET", path: "/v1/namespaces/:namespace/metadata", action: "compat.metadata" },
  { method: "GET", path: "/v2/namespaces/:namespace/metadata", action: "compat.metadata" },
  {
    method: "PATCH",
    path: "/v1/namespaces/:namespace/metadata",
    action: "compat.updateMetadata",
  },
  { method: "GET", path: "/v1/namespaces/:namespace/schema", action: "compat.schema" },
  { method: "POST", path: "/v1/namespaces/:namespace/schema", action: "compat.updateSchema" },
  {
    method: "GET",
    path: "/v1/namespaces/:namespace/hint_cache_warm",
    action: "compat.warmCache",
  },
  { method: "POST", path: "/v1/namespaces/:namespace/_debug/recall", action: "compat.recall" },
] as const;

export type Action = (typeof ROUTES)[number]["action"];
