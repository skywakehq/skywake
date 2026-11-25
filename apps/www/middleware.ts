import { NextResponse, type NextRequest } from "next/server";

import { defaultLocale, isLocale, localizePath, stripLocale } from "@/lib/i18n";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Agents that ask the home page for Markdown get llms.txt, the site in Markdown.
  const home = pathname === "/" || isLocale(pathname.slice(1));
  if (home && (request.headers.get("accept") ?? "").includes("text/markdown")) {
    return NextResponse.rewrite(new URL("/llms.txt", request.url));
  }

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".") ||
    pathname.startsWith("/docs") ||
    pathname.startsWith("/dashboard")
  ) {
    return NextResponse.next();
  }

  const segment = pathname.split("/").filter(Boolean)[0];

  // English has no prefix, so old /en links move to the root.
  if (segment === defaultLocale) {
    const url = request.nextUrl.clone();
    url.pathname = stripLocale(pathname);
    const response = NextResponse.redirect(url, 308);
    response.cookies.set("NEXT_LOCALE", defaultLocale, { path: "/" });
    return response;
  }

  if (segment && isLocale(segment)) {
    const response = NextResponse.next();
    response.cookies.set("NEXT_LOCALE", segment, { path: "/" });
    response.headers.set("x-locale", segment);
    return response;
  }

  // A visitor who picked another language in the switcher goes back to it.
  const saved = request.cookies.get("NEXT_LOCALE")?.value;
  if (saved && isLocale(saved) && saved !== defaultLocale) {
    const url = request.nextUrl.clone();
    url.pathname = localizePath(saved, pathname);
    return NextResponse.redirect(url);
  }

  // Everyone else gets English right here, with no redirect.
  const url = request.nextUrl.clone();
  url.pathname = `/${defaultLocale}${pathname === "/" ? "" : pathname}`;
  const response = NextResponse.rewrite(url);
  response.headers.set("x-locale", defaultLocale);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon|robots.txt|sitemap.xml|llms.txt|llms-full.txt|.well-known).*)",
  ],
};
