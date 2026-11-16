import { relative } from "../paths.ts";

export function shownPath(found: string, folder: string, typed: string | undefined, cwd: string) {
  const path = `/${found}`;
  if (typed === undefined) return relative(path, cwd);
  if (path === folder) return typed;
  const rest = path.slice(folder === "/" ? 1 : folder.length + 1);
  return typed.endsWith("/") ? `${typed}${rest}` : `${typed}/${rest}`;
}
