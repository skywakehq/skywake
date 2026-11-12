// What a file is, from its name: how to preview it and which type to serve it as.

export type Kind = "image" | "video" | "audio" | "pdf" | "text" | "archive" | "other";

const TYPES: Record<string, [Kind, string]> = {
  png: ["image", "image/png"],
  jpg: ["image", "image/jpeg"],
  jpeg: ["image", "image/jpeg"],
  gif: ["image", "image/gif"],
  webp: ["image", "image/webp"],
  avif: ["image", "image/avif"],
  svg: ["image", "image/svg+xml"],
  bmp: ["image", "image/bmp"],
  ico: ["image", "image/x-icon"],
  mp4: ["video", "video/mp4"],
  m4v: ["video", "video/mp4"],
  webm: ["video", "video/webm"],
  mov: ["video", "video/quicktime"],
  ogv: ["video", "video/ogg"],
  mp3: ["audio", "audio/mpeg"],
  wav: ["audio", "audio/wav"],
  ogg: ["audio", "audio/ogg"],
  m4a: ["audio", "audio/mp4"],
  flac: ["audio", "audio/flac"],
  aac: ["audio", "audio/aac"],
  pdf: ["pdf", "application/pdf"],
  zip: ["archive", "application/zip"],
  gz: ["archive", "application/gzip"],
  tgz: ["archive", "application/gzip"],
  tar: ["archive", "application/x-tar"],
  "7z": ["archive", "application/x-7z-compressed"],
  rar: ["archive", "application/vnd.rar"],
  json: ["text", "application/json"],
  html: ["text", "text/plain"],
  csv: ["text", "text/csv"],
};

const TEXT =
  /^(txt|md|mdx|ts|tsx|js|jsx|mjs|cjs|py|rs|go|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|bash|sql|toml|yaml|yml|ini|cfg|conf|env|xml|css|scss|less|log|lock|gitignore|dockerfile|makefile|tf|proto|graphql|vue|svelte)$/;

const extension = (name: string) => {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(dot + 1) : name).toLowerCase();
};

export function kindOf(name: string): Kind {
  const ext = extension(name);
  return TYPES[ext]?.[0] ?? (TEXT.test(ext) ? "text" : "other");
}

/** The type to serve a file as. HTML is served as plain text so it never runs in the console. */
export function mimeOf(name: string) {
  const ext = extension(name);
  return (
    TYPES[ext]?.[1] ?? (TEXT.test(ext) ? "text/plain; charset=utf-8" : "application/octet-stream")
  );
}

export function bytes(size: number) {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
