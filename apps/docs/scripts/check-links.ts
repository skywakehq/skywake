// Fails when a guide links to a page that doesn't exist: a relative `.mdx`
// file, or a route under /docs from any source (guides, API, CLI, SDKs).
// Run by `build`, so a broken link can't ship.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { operations } from "../content/sdk/examples.ts";

const root = resolve(import.meta.dirname, "..");
const content = join(root, "content/docs");

interface Command {
  path: string[];
  subcommands: Command[];
}

function mdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(path);
    return entry.name.endsWith(".mdx") ? [path] : [];
  });
}

/** Every route the site serves, without the `/docs` basePath. */
function routes(files: string[]): Set<string> {
  const all = new Set<string>();
  for (const file of files) {
    const slug = relative(content, file)
      .replace(/\.mdx$/, "")
      .replace(/(^|\/)index$/, "");
    all.add(`/${slug}`.replace(/\/$/, "") || "/");
  }
  const openapi = JSON.parse(
    readFileSync(join(root, "../../packages/contract/generated/openapi.json"), "utf8"),
  );
  for (const methods of Object.values<Record<string, { operationId: string; tags: string[] }>>(
    openapi.paths,
  )) {
    for (const operation of Object.values(methods)) {
      all.add(`/reference/api/${operation.tags[0]}/${operation.operationId}`);
    }
  }
  const visit = (command: Command) => {
    all.add(["/reference/cli", ...command.path].join("/"));
    command.subcommands.forEach(visit);
  };
  visit(JSON.parse(readFileSync(join(root, "generated/cli.json"), "utf8")));
  all.add("/reference/sdk");
  for (const operation of operations) all.add(`/reference/sdk/${operation.slug}`);
  return all;
}

/** Markdown links and JSX `href`s, skipping code blocks and inline code. */
function links(source: string): string[] {
  const prose = source.replace(/^```[\s\S]*?^```/gm, "").replace(/`[^`\n]*`/g, "");
  const markdown = [...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  const jsx = [...prose.matchAll(/href=["']([^"']+)["']/g)].map((match) => match[1]);
  return [...markdown, ...jsx];
}

const files = mdxFiles(content);
const known = routes(files);
const broken: string[] = [];
for (const file of files) {
  for (const link of links(readFileSync(file, "utf8"))) {
    if (/^(https?:|mailto:|#)/.test(link)) continue;
    const target = link.split("#")[0];
    const ok = target.startsWith("/")
      ? !target.startsWith("/docs/") && known.has(target.replace(/\/$/, "") || "/")
      : existsSync(resolve(dirname(file), target));
    if (!ok) broken.push(`${relative(root, file)}: ${link}`);
  }
}

if (broken.length > 0) {
  console.error(
    `broken links (write guides as ./page.mdx, other routes as /reference/...):\n  ${broken.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`links: ${files.length} pages, all internal links resolve`);
