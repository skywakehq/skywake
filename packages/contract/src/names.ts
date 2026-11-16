export const DEFAULT_ENVIRONMENT = "default";

export function environmentOf(name: string) {
  const slash = name.indexOf("/");
  return slash < 0 ? DEFAULT_ENVIRONMENT : name.slice(0, slash);
}

export function nameIn(name: string) {
  const slash = name.indexOf("/");
  return slash < 0 ? name : name.slice(slash + 1);
}

export function qualify(environment: string, name: string) {
  return environment === DEFAULT_ENVIRONMENT ? name : `${environment}/${name}`;
}

export function globMatches(pattern: string, name: string) {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return name.startsWith(pattern.slice(0, -1));
  return pattern === name;
}

export function globCovers(outer: string, inner: string) {
  if (outer === "*") return true;
  if (outer.endsWith("*")) return inner.startsWith(outer.slice(0, -1));
  return outer === inner;
}

export interface KeyScope {
  environment: string | null;
  only: string[];
}

export function scopeOfPattern(pattern: string): KeyScope {
  if (pattern === "*") return { environment: null, only: ["*"] };
  const slash = pattern.indexOf("/");
  if (slash < 0) return { environment: DEFAULT_ENVIRONMENT, only: [pattern] };
  return { environment: pattern.slice(0, slash), only: [pattern.slice(slash + 1)] };
}

export function patternOfScope({ environment, only }: KeyScope) {
  if (environment === null) return "*";
  return only.map((each) => qualify(environment, each)).join(",");
}
