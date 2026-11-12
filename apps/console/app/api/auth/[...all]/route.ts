import { toNextJsHandler } from "better-auth/next-js";
import { basePath, withBase } from "@/lib/zone";
import { auth } from "@/server/auth";

const handler = toNextJsHandler(auth);

// Next leaves the base path out of request.url, but Better Auth's own
// address has it, so it is put back before Better Auth matches the path.
function inZone(handle: (request: Request) => Promise<Response>) {
  if (!basePath) return handle;
  return (request: Request) => {
    const url = new URL(request.url);
    url.pathname = withBase(url.pathname);
    const init = {
      method: request.method,
      headers: request.headers,
      body: request.body,
      duplex: "half",
    };
    return handle(new Request(url, init as RequestInit));
  };
}

export const GET = inZone(handler.GET);
export const POST = inZone(handler.POST);
