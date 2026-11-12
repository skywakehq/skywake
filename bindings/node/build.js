import { copyFileSync, rmSync } from "node:fs";

const name =
  { darwin: "libskywake_node.dylib", win32: "skywake_node.dll" }[process.platform] ??
  "libskywake_node.so";
const target = new URL("engine.node", import.meta.url);
// A new file, not an overwrite: macOS kills processes whose loaded library changes in place.
rmSync(target, { force: true });
copyFileSync(new URL(`../../target/release/${name}`, import.meta.url), target);
