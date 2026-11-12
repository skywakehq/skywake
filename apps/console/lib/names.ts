// An environment is the first part of a namespace's name: `prod/website` is
// the namespace `website` in the environment `prod` (the console calls it a
// filesystem). A name with no `/` is in the environment `default`. The API
// keeps each filesystem's and index's region; keys for `prod/*` reach one environment.

export const DEFAULT = "default";

export function envOf(ns: string) {
  const slash = ns.indexOf("/");
  return slash < 0 ? DEFAULT : ns.slice(0, slash);
}

/** The namespace's name within its environment. */
export function nameInEnv(ns: string) {
  const slash = ns.indexOf("/");
  return slash < 0 ? ns : ns.slice(slash + 1);
}

export function namespaceName(env: string, name: string) {
  return env === DEFAULT ? name : `${env}/${name}`;
}
