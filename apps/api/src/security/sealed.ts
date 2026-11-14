import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM: `v1.` + base64url(nonce ‖ ciphertext ‖ tag). The context binds a
// sealed value to where it is kept, so one row's secret can't be moved to another.
const VERSION = "v1.";

export function seal(key: Buffer, plain: string, context: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return VERSION + Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url");
}

export function unseal(key: Buffer, sealed: string, context: string): string {
  if (!sealed.startsWith(VERSION)) throw new Error("not a sealed value");
  const raw = Buffer.from(sealed.slice(VERSION.length), "base64url");
  if (raw.length < 28) throw new Error("not a sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  const plain = decipher.update(raw.subarray(12, raw.length - 16));
  return Buffer.concat([plain, decipher.final()]).toString("utf8");
}
