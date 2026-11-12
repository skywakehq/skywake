import { llms } from "fumadocs-core/source/llms";

import { source, type Page } from "./source";
import { absoluteUrl } from "./zone";

async function renderPage(page: Page) {
  const body =
    page.type === "docs"
      ? await page.data.getText("processed")
      : page.type === "openapi"
        ? `The request and response schemas are in the OpenAPI document: ${absoluteUrl("/api/openapi/skywake")}`
        : "";
  const intro = page.data.description ? `\n\n${page.data.description}` : "";
  return `# ${page.data.title}\n\nURL: ${absoluteUrl(page.url)}${intro}\n\n${body}`.trimEnd();
}

export const docsLLMs = llms(source, {
  renderUrl: (item) => absoluteUrl(item.url),
  renderPage,
});
