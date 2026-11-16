export function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function resolve(base: string, path: string): string {
  return normalize(path.startsWith("/") ? path : `${base}/${path}`);
}

export function parent(path: string): string {
  return normalize(path.slice(0, path.lastIndexOf("/")));
}

export function name(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function join(folder: string, child: string): string {
  return folder === "/" ? `/${child}` : `${folder}/${child}`;
}

export function within(path: string, folder: string): boolean {
  return folder === "/" || path === folder || path.startsWith(`${folder}/`);
}

export function below(path: string, folder: string): boolean {
  return path !== folder && within(path, folder);
}

export function ancestors(path: string): string[] {
  const found: string[] = [];
  for (let at = parent(path); at !== "/"; at = parent(at)) found.push(at);
  if (path !== "/") found.push("/");
  return found;
}

export function rebase(path: string, from: string, to: string): string {
  return path === from ? to : join(to, path.slice(from === "/" ? 1 : from.length + 1));
}

export function relative(path: string, cwd: string): string {
  if (path === cwd) return ".";
  return below(path, cwd) ? path.slice(cwd === "/" ? 1 : cwd.length + 1) : path;
}

export function remote(path: string): string {
  return path.slice(1);
}
