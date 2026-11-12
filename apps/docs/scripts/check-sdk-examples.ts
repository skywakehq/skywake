// Every SDK example calls only what its SDK defines. A cheap static check:
// it collects the names each SDK declares with a few regexes, then fails on
// any name an example uses that is neither declared nor allowed below.
//
//   node apps/docs/scripts/check-sdk-examples.ts

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { languages, operations, type Language } from "../content/sdk/examples.ts";

const sdks = join(import.meta.dirname, "../../../sdks");

interface Rules {
  /** Source directory under `sdks/` and the file extension to read. */
  dir: string;
  ext: string;
  /** Regexes over the source; group 1 is a name, or a list of names. */
  defines: RegExp[];
  /** Regexes over an example; group 1 is a name it uses. */
  uses: RegExp[];
  /** Standard-library names, removed from an example before it is checked. */
  allow: string[];
  /** Line comments start with this. */
  comment: string;
}

// A type, `>` or `?`, then a name: declarations of methods, fields,
// properties, parameters and record components in Java and C#.
const declared = /[\w>\]?]\s+([A-Za-z_]\w*)\s*[,)=;{(<]/g;
const capitalized = /\b([A-Z]\w*)/g;

const rules: Record<Language, Rules> = {
  typescript: {
    dir: "typescript/src",
    ext: ".ts",
    defines: [
      /^\s+(?:async\s+)?\*?\s*([A-Za-z_]\w*)\s*[<(]/gm, // methods
      /\b(?:class|interface|type)\s+(\w+)/g,
      /\breadonly\s+(\w+)/g,
      /^\s+(\w+)\??:/gm, // fields of the generated API types
      /^export\s*\{([^}]*)\}/gm,
    ],
    uses: [/\.([A-Za-z_]\w*)/g, /\bnew\s+(\w+)/g, /\bimport\s*\{([^}]*)\}/g],
    allow: ["process.env", "console.log"],
    comment: "//",
  },
  python: {
    dir: "python/skywake",
    ext: ".py",
    defines: [/\bdef\s+(\w+)/g, /\bclass\s+(\w+)/g, /\bself\.(\w+)\s*=/g],
    uses: [/\.([A-Za-z_]\w*)/g, /(?<![.\w])([A-Z]\w*)\(/g, /\bfrom skywake import\s+([\w, ]+)/g],
    allow: ["os.environ"],
    comment: "#",
  },
  go: {
    dir: "go",
    ext: ".go",
    defines: [
      /\bfunc\s+(?:\([^)]*\)\s*)?(\w+)/g,
      /\btype\s+(\w+)/g,
      /^\s+([A-Z]\w*)\s+[\w[\]*.]/gm, // struct fields
      /^package\s+(\w+)/gm,
    ],
    // Every exported name: types, functions, methods and fields.
    uses: [capitalized, /\b(skywake)\./g],
    allow: ["fmt.Println", "os.Getenv", "context.Background"],
    comment: "//",
  },
  ruby: {
    dir: "ruby/lib",
    ext: ".rb",
    defines: [
      /\bdef\s+(?:self\.)?(\w+[?!]?)/g,
      /\b(?:class|module)\s+(\w+)/g,
      /\battr_(?:reader|accessor)\s+([:\w, ]+)/g,
    ],
    uses: [/\.([a-z_]\w*[?!]?)/g, capitalized],
    allow: ["ENV", "new", "each"],
    comment: "#",
  },
  rust: {
    dir: "rust/src",
    ext: ".rs",
    defines: [
      /\bpub\s+(?:async\s+)?fn\s+(\w+)/g,
      /\bpub\s+(?:struct|enum|type|trait)\s+(\w+)/g,
      /\bpub\s+(\w+):/g, // fields
      /\bpub\s+use\s+[\w:]*\{([^}]*)\}/g,
    ],
    uses: [
      /\.([a-z_]\w*)/g,
      capitalized,
      /::([a-z_]\w*)\(/g,
      /(?<!let |mut )\b([a-z_]\w*): /g, // struct literal fields
    ],
    allow: [
      "println!",
      "vec!",
      "json!",
      "serde_json::from_value",
      "env::var",
      "Default::default",
      "default",
      "Some",
      "Vec",
      "Map",
      "iter",
      "insert",
      "into",
      "await",
    ],
    comment: "//",
  },
  java: {
    dir: "java/src/main",
    ext: ".java",
    defines: [declared, /\b(?:class|record|interface|enum)\s+(\w+)/g],
    uses: [/\.([a-z]\w*)\(/g, capitalized],
    allow: ["System.getenv", "System.out.println", "List", "Map"],
    comment: "//",
  },
  csharp: {
    dir: "csharp/src",
    ext: ".cs",
    defines: [declared, /\b(?:class|record|struct|interface|enum|namespace)\s+(\w+)/g],
    uses: [capitalized],
    allow: ["Console.WriteLine", "Environment.GetEnvironmentVariable", "Dictionary"],
    comment: "//",
  },
};

function files(dir: string, ext: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(ext) && !file.endsWith("_test.go"))
    .map((file) => join(dir, file));
}

/** Each name in group 1 of every match; a group may hold a list, such as `{ A, B }`. */
function names(text: string, patterns: RegExp[]): string[] {
  return patterns.flatMap((pattern) =>
    [...text.matchAll(pattern)].flatMap((match) => match[1]!.match(/\w+[?!]?/g) ?? []),
  );
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The example's code, without strings, comments or allowed names. */
function code(example: string, rule: Rules): string {
  let text = example.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  text = text.replace(new RegExp(`${escape(rule.comment)}.*$`, "gm"), "");
  for (const name of rule.allow) {
    // A name takes the rest of its path with it: `Map` covers `Map.of`.
    text = text.replace(new RegExp(`(?<!\\w)${escape(name)}(?!\\w)(?:(?:\\.|::)\\w+)*`, "g"), "");
  }
  return text;
}

const problems: string[] = [];
const slugs = new Set<string>();
let count = 0;

const defined = Object.fromEntries(
  languages.map((language) => {
    const rule = rules[language];
    const source = files(join(sdks, rule.dir), rule.ext)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    return [language, new Set(names(source, rule.defines))];
  }),
) as Record<Language, Set<string>>;

for (const operation of operations) {
  if (slugs.has(operation.slug)) problems.push(`${operation.slug}: duplicate slug`);
  slugs.add(operation.slug);
  const examples = Object.entries(operation.examples) as [Language, string][];
  if (examples.length === 0) problems.push(`${operation.slug}: no examples`);
  for (const [language, example] of examples) {
    count++;
    const missing = new Set(
      names(code(example, rules[language]), rules[language].uses).filter(
        (name) => !defined[language].has(name),
      ),
    );
    for (const name of missing)
      problems.push(`${operation.slug} (${language}): ${name} is not in the SDK`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`sdk examples: ${operations.length} operations, ${count} examples, all names found`);
