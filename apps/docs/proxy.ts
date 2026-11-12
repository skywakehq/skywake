import { NextResponse, type NextRequest } from "next/server";

// Agents that ask for Markdown get the page as Markdown.
export function proxy(request: NextRequest) {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/markdown")) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = `/llms.mdx${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!api|llms|og|_next|.*\\..*).*)"],
};
