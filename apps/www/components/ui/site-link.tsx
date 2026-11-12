import Link from "next/link";
import type { ReactNode } from "react";

import { localizePath, type Locale } from "@/lib/i18n";

export function SiteLink({
  href,
  className,
  children,
  locale,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  locale?: Locale;
}) {
  if (href.startsWith("/")) {
    const localized = locale ? localizePath(locale, href) : href;
    return (
      <Link href={localized} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
