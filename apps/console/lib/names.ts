// An environment is the first part of an index's full name: `prod/products` is
// the index `products` in the environment `prod`. A name with no `/` is in the
// environment `default`. Keys for `prod/*` reach one environment.

export const DEFAULT = "default";

export function envOf(ns: string) {
  const slash = ns.indexOf("/");
  return slash < 0 ? DEFAULT : ns.slice(0, slash);
}

/** The name within its environment. */
export function nameInEnv(ns: string) {
  const slash = ns.indexOf("/");
  return slash < 0 ? ns : ns.slice(slash + 1);
}

export function namespaceName(env: string, name: string) {
  return env === DEFAULT ? name : `${env}/${name}`;
}
