const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const utf8 = (text: string) => encoder.encode(text);

export function asText(bytes: Uint8Array): string | undefined {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return undefined;
  }
  const json = encoder.encode(JSON.stringify(text)).length;
  return json <= Math.ceil(bytes.length / 3) * 4 + 2 ? text : undefined;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
