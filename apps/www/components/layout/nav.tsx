import { ArrowUpRight } from "lucide-react";

import { Logo } from "@skywake/ui/components/logo";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { SiteLink } from "@/components/ui/site-link";
import { getMessages, type HomeMessages } from "@/content/messages";
import { site } from "@/content/site";
import { defaultLocale, type Locale } from "@/lib/i18n";
import { ThemeToggle } from "./theme-toggle";

const LINK =
  "t-small rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground";

export function Nav({
  locale = defaultLocale,
  messages,
}: {
  locale?: Locale;
  messages?: HomeMessages;
}) {
  const t = messages ?? getMessages(locale);
  const links = [
    { href: "/filesystem", label: t.nav.filesystem },
    { href: "/search", label: t.nav.search },
    { href: "/#benchmarks", label: t.nav.benchmarks },
    { href: "/pricing", label: t.nav.pricing },
    { href: site.docsUrl, label: t.nav.docs },
  ];

  return (
    <header className="sticky top-3 z-40 mx-auto mt-3 w-full max-w-6xl px-3 sm:px-0">
      <div className="flex h-14 items-center gap-1 rounded-2xl border border-border bg-card/90 pr-2 pl-4 shadow-[0_10px_30px_-24px_color-mix(in_oklab,var(--foreground)_55%,transparent)] backdrop-blur-md">
        <SiteLink
          href="/"
          locale={locale}
          className="t-body mr-3 flex items-center gap-2 font-medium tracking-[-0.02em] text-foreground"
        >
          <Logo className="size-[18px]" />
          {site.name}
        </SiteLink>
        <nav aria-label="Sections" className="ml-4 hidden items-center md:flex">
          {links.map((link) => (
            <SiteLink key={link.label} href={link.href} locale={locale} className={LINK}>
              {link.label}
            </SiteLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <LocaleSwitcher locale={locale} label={t.nav.language} />
          <ThemeToggle />
          {site.repoUrl && (
            <a href={site.repoUrl} className={`${LINK} hidden sm:block`}>
              {t.nav.github}
            </a>
          )}
          {site.cloudOpen ? (
            <a href={site.consoleUrl} className="btn btn-sm btn-primary">
              {t.nav.getStarted} <ArrowUpRight className="size-3.5" />
            </a>
          ) : (
            <SiteLink href="/#waitlist" locale={locale} className="btn btn-sm btn-primary">
              {t.nav.joinWaitlist}
            </SiteLink>
          )}
        </div>
      </div>
    </header>
  );
}
