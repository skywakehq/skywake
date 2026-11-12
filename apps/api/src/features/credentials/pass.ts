import { createHmac } from "node:crypto";

import type { Access } from "./mint.ts";

export function passFor(
  token: string,
  folder: string,
  access: Access,
  protectedBranches: string[],
  expiresAt: string,
) {
  const body = Buffer.from(
    JSON.stringify({
      folder,
      access,
      protected: protectedBranches,
      expires: Math.floor(Date.parse(expiresAt) / 1000),
    }),
  );
  const tag = createHmac("sha256", token).update(body).digest();
  return `${body.toString("base64url")}.${tag.toString("base64url")}`;
}
