import base from "@skywake/config/eslint.mjs";

// The shared rules are for Next.js apps; this one has no pages folder.
const config = [
  ...base,
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
  { ignores: ["dist/**", "src-tauri/**"] },
];

export default config;
