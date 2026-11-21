import type { ReactNode } from "react";

import { Frame } from "@/components/ui/frame";
import type { HomeMessages } from "@/content/messages";
import type { Locale } from "@/lib/i18n";
import { Footer } from "./footer";
import { Nav } from "./nav";

/** Every page: the nav, the framed column of bands, and the footer, drawn 10% larger. */
export function SitePage({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: Locale;
  messages: HomeMessages;
}) {
  return (
    <div className="overflow-x-clip">
      <Nav locale={locale} messages={messages} />
      <main>
        <Frame>{children}</Frame>
      </main>
      <Footer locale={locale} messages={messages} />
    </div>
  );
}
