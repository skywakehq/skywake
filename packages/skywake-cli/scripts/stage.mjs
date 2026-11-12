// Sets the release version, names the repository for npm provenance, and copies
// each prebuilt binary into its platform package.
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [version, x64, arm64] = process.argv.slice(2);
if (!version || !x64 || !arm64) {
  console.error("usage: node scripts/stage.mjs <version> <linux-x64 binary> <linux-arm64 binary>");
  process.exit(1);
}

const root = new URL("..", import.meta.url);
const repository = process.env.GITHUB_REPOSITORY;
const update = (path, change) => {
  const file = new URL(path, root);
  const json = JSON.parse(readFileSync(file, "utf8"));
  change(json);
  if (repository)
    json.repository = { type: "git", url: `git+https://github.com/${repository}.git` };
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
};

update("package.json", (json) => {
  json.version = version;
  for (const name of Object.keys(json.optionalDependencies))
    json.optionalDependencies[name] = version;
});
for (const [platform, binary] of [
  ["linux-x64", x64],
  ["linux-arm64", arm64],
]) {
  update(`npm/${platform}/package.json`, (json) => (json.version = version));
  const bin = new URL(`npm/${platform}/bin/`, root);
  mkdirSync(bin, { recursive: true });
  copyFileSync(binary, new URL("skywake", bin));
  chmodSync(new URL("skywake", bin), 0o755);
}
