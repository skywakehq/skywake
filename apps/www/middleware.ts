import { NextResponse, type NextRequest } from "next/server";

import { defaultLocale, isLocale } from "@/lib/i18n";

function detectLocale(request: NextRequest) {
  const cookie = request.cookies.get("NEXT_LOCALE")?.value;
  if (cookie && isLocale(cookie)) return cookie;

  const header = request.headers.get("accept-language") ?? "";
  const preferred = header
    .split(",")
    .map((part) => part.trim().split(";")[0]?.toLowerCase())
    .filter(Boolean);

  for (const tag of preferred) {
    const base = tag!.slice(0, 2);
    if (isLocale(base)) return base;
  }

  return defaultLocale;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".") ||
    pathname.startsWith("/og") ||
    pathname.startsWith("/docs") ||
    pathname.startsWith("/dashboard")
  ) {
    return NextResponse.next();
  }

  const segment = pathname.split("/").filter(Boolean)[0];
  if (segment && isLocale(segment)) {
    const response = NextResponse.next();
    response.cookies.set("NEXT_LOCALE", segment, { path: "/" });
    response.headers.set("x-locale", segment);
    return response;
  }

  const locale = detectLocale(request);
  const url = request.nextUrl.clone();
  url.pathname = pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
  const response = NextResponse.redirect(url);
  response.cookies.set("NEXT_LOCALE", locale, { path: "/" });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon|robots.txt|sitemap.xml|llms.txt).*)"],
};
