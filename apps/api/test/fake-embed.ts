import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const TOPICS = ["shoe", "coffee", "invoice", "giraffe"];

export function vectorOf(text: string) {
  const lower = text.toLowerCase();
  return [...TOPICS.map((word) => lower.split(word).length - 1), 0.05];
}

export async function fakeEmbedder(): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (part) => (raw += part));
    request.on("end", () => {
      const inputs: string[] = JSON.parse(raw).input;
      const data = inputs.map((text, index) => ({ index, embedding: vectorOf(text) }));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, server };
}
