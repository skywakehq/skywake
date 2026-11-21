import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LoaderPlugin } from "fumadocs-core/source";
import type { Document } from "fumadocs-openapi";
import { createOpenAPI } from "fumadocs-openapi/server";

const hiddenTags = new Set(["indexes", "links"]);

async function publicDocument(): Promise<Document> {
  const path = resolve("../../packages/contract/generated/openapi.json");
  const document = JSON.parse(await readFile(path, "utf8")) as Document;
  for (const [route, item] of Object.entries(document.paths ?? {})) {
    if (!item) continue;
    for (const [method, operation] of Object.entries(item)) {
      const tags = (operation as { tags?: string[] } | undefined)?.tags;
      if (tags?.some((tag) => hiddenTags.has(tag))) delete item[method as keyof typeof item];
    }
    if (!Object.values(item).some((value) => (value as { operationId?: string })?.operationId)) {
      delete document.paths![route];
    }
  }
  document.tags = document.tags?.filter((tag) => !hiddenTags.has(tag.name ?? ""));
  return document;
}

export const openapi = createOpenAPI({
  input: { skywake: publicDocument },
  includeDocument: false,
});

const acronyms: Record<string, string> = { ip: "IP", sso: "SSO" };

/**
 * The contract's summaries are whole sentences, too long for a title or the
 * sidebar. Name each page after its operation, `listBranches` as "List branches",
 * and keep the summary as its description.
 */
export const operationTitles: LoaderPlugin = {
  name: "skywake:operation-titles",
  transformStorage({ storage }) {
    for (const path of storage.getFiles()) {
      const file = storage.read(path);
      const id = path.match(/^reference\/api\/.+\/(\w+)\.mdx$/)?.[1];
      if (!id || file?.format !== "page") continue;
      const words = id
        .split(/(?=[A-Z])/)
        .map((word) => acronyms[word.toLowerCase()] ?? word.toLowerCase());
      const title = words.join(" ");
      file.data.description = file.data.title;
      file.data.title = title.charAt(0).toUpperCase() + title.slice(1);
    }
  },
};
