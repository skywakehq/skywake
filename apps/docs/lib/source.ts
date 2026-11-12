import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";
import { defineDocs } from "fumadocs-mdx/macro";
import { cliSource } from "./cli/source";
import { openapi, operationTitles } from "./openapi";
import { sdkSource } from "./sdk/source";

const docs = defineDocs({
  dir: "content/docs",
  // Each guide also as plain Markdown, for llms.txt and the `.md` pages.
  docs: { postprocess: { includeProcessedMarkdown: true } },
});

/** Guides from MDX, and the three references, generated. */
export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({
      baseDir: "reference/api",
      per: "operation",
      groupBy: "tag",
      meta: true,
    }),
    cli: cliSource(),
    sdk: sdkSource(),
  },
  {
    // Next adds the base path (`/docs` by default) to every link.
    baseUrl: "/",
    // Pages and folders name a Lucide icon (`icon: GitFork`); the sidebar draws it.
    plugins: [openapi.loaderPlugin(), operationTitles, lucideIconsPlugin()],
  },
);

export type Page = NonNullable<ReturnType<typeof source.getPage>>;
