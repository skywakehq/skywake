import type { ReactNode } from "react";

import type { HomeMessages } from "@/content/messages";
import { defaultLocale, type Locale } from "@/lib/i18n";
import { Footer } from "./footer";
import { Nav } from "./nav";

export function SitePage({
  children,
  locale = defaultLocale,
  messages,
}: {
  children: ReactNode;
  locale?: Locale;
  messages?: HomeMessages;
}) {
  return (
    <div className="relative overflow-x-clip">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-full max-w-6xl -translate-x-1/2 border-x border-border"
      />
      <Nav locale={locale} messages={messages} />
      <main>{children}</main>
      <Footer locale={locale} messages={messages} />
    </div>
  );
}
