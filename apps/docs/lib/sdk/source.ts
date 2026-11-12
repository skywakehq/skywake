import type { StructuredData } from "fumadocs-core/mdx-plugins/remark-structure";
import type { StaticSource } from "fumadocs-core/source";
import { labels, languages, operations, type SdkOperation } from "@/content/sdk/examples";

interface SdkPageData {
  title: string;
  description: string;
  /** Absent on the index page, which lists every operation. */
  operation?: SdkOperation;
  structuredData: StructuredData;
}

type SdkSource = StaticSource<{
  pageData: SdkPageData;
  metaData: { title?: string; icon?: string; pages?: string[] };
}>;

const baseDir = "reference/sdk";

/** A page per operation, with an example in each SDK that has it. */
export function sdkSource(): SdkSource {
  return {
    files: [
      {
        type: "meta",
        path: `${baseDir}/meta.json`,
        data: {
          title: "SDKs",
          icon: "Braces",
          pages: operations.map((operation) => operation.slug),
        },
      },
      {
        type: "page",
        path: `${baseDir}/index.mdx`,
        data: {
          title: "SDKs",
          description: `One client per language: ${languages.map((language) => labels[language]).join(", ")}.`,
          structuredData: { headings: [], contents: [] },
        },
      },
      ...operations.map((operation) => ({
        type: "page" as const,
        path: `${baseDir}/${operation.slug}.mdx`,
        data: {
          title: operation.title,
          description: operation.description,
          operation,
          structuredData: {
            headings: [],
            contents: Object.values(operation.examples).map((code) => ({
              heading: undefined,
              content: code,
            })),
          },
        },
      })),
    ],
  };
}

/** The examples an operation has, in the order of `languages`. */
export function examplesOf(operation: SdkOperation) {
  return languages.flatMap((language) => {
    const code = operation.examples[language];
    return code ? [{ language, label: labels[language], code }] : [];
  });
}
