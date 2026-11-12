import type { LoaderPlugin } from "fumadocs-core/source";
import { createOpenAPI } from "fumadocs-openapi/server";

export const openapi = createOpenAPI({
  input: { skywake: "../../packages/contract/generated/openapi.json" },
  includeDocument: false,
});

const acronyms: Record<string, string> = { ip: "IP", sso: "SSO" };

/**
 * The contract's summaries are whole sentences, too long for a title or the
 * sidebar. Name each page after its operation, `queryIndex` as "Query index",
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
