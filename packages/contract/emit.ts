import { writeFileSync } from "node:fs";

import { document, v2 } from "./src/index.ts";

const write = (name: string, doc: unknown) =>
  writeFileSync(new URL(`generated/${name}`, import.meta.url), JSON.stringify(doc, null, 2) + "\n");

write("openapi.json", document());
write("openapi-v2.json", v2.document());
