import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { signInQuery } from "./lib/auth-error";

// A quick check for a session cookie. Pages and routes check the session
// itself; this only sends people who are signed out to the sign-in page.
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  // nextUrl keeps the base path, and its pathname leaves it out.
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = signInQuery(request.nextUrl).toString();
  return NextResponse.redirect(url);
}

export const config = {
  // The invite page works signed out too: it offers to sign in or up.
  matcher: [
    "/((?!api|_next|sign-in|sign-up|two-factor|forgot-password|reset-password|invite|favicon.ico).*)",
  ],
};
