import { writeFileSync } from "node:fs";

import { document } from "./src/index.ts";

writeFileSync(
  new URL("generated/openapi.json", import.meta.url),
  JSON.stringify(document(), null, 2) + "\n",
);
