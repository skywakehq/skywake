import Link from "fumadocs-core/link";
import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import {
  labels,
  languages,
  operations,
  type Language,
  type SdkOperation,
} from "@/content/sdk/examples";
import { examplesOf } from "@/lib/sdk/source";

const shikiLang: Record<Language, string> = {
  typescript: "ts",
  python: "python",
  go: "go",
  ruby: "ruby",
  rust: "rust",
  java: "java",
  csharp: "csharp",
};

/** One operation, with a tab per SDK. The chosen language sticks across pages. */
export function OperationPage({ operation }: { operation: SdkOperation }) {
  const examples = examplesOf(operation);
  return (
    <Tabs groupId="sdk-language" persist items={examples.map((example) => example.label)}>
      {examples.map((example) => (
        <Tab key={example.language} value={example.label}>
          <ServerCodeBlock code={example.code} lang={shikiLang[example.language]} />
        </Tab>
      ))}
    </Tabs>
  );
}

/** Every operation, and which SDKs have it. */
export function OperationIndex() {
  return (
    <div className="sw-rows not-prose">
      {operations.map((operation) => {
        const has = new Set(examplesOf(operation).map((example) => example.language));
        return (
          <Link key={operation.slug} href={`/reference/sdk/${operation.slug}`} className="sw-row">
            <span className="sw-row-name">{operation.title}</span>
            <span className="sw-row-text">
              {languages.length === has.size
                ? "Every SDK"
                : languages
                    .filter((language) => has.has(language))
                    .map((language) => labels[language])
                    .join(", ")}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
