import { ArrowUpRight, Star } from "lucide-react";
import { siGithub } from "simple-icons";

import { Logo } from "@skywake/ui/components/logo";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { ConsoleLink } from "@/components/ui/console-link";
import { SiteLink } from "@/components/ui/site-link";
import type { HomeMessages } from "@/content/messages";
import { site } from "@/content/site";
import { githubStars } from "@/lib/github-stars";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { NAV_ICON } from "./nav-icon";
import { MobileMenu } from "./mobile-menu";
import { ThemeToggle } from "./theme-toggle";

const LINK =
  "px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground";
const CTA = "btn btn-primary h-10 gap-1.5 px-4";

export async function Nav({ locale, messages: t }: { locale: Locale; messages: HomeMessages }) {
  const links = [
    { href: "/use-cases", label: t.footer.useCases },
    { href: "/pricing", label: t.nav.pricing },
    { href: site.docsUrl, label: t.nav.docs },
  ];
  // GitHub hides from the bar on phones, so the menu carries it.
  const stars = site.repoUrl ? await githubStars(site.repoUrl) : null;
  const menuLinks = site.repoUrl ? [...links, { href: site.repoUrl, label: t.nav.github }] : links;

  return (
    <header className="sticky top-3 z-40 mx-auto mt-3 w-full max-w-6xl px-3 sm:px-0">
      <div className="relative flex h-14 items-center rounded-full bg-card/80 pr-2 pl-5 backdrop-blur-xl">
        <SiteLink
          href="/"
          locale={locale}
          className="flex items-center gap-2 text-[17px] font-medium tracking-[-0.02em] text-foreground"
        >
          <Logo className="size-5" />
          {site.name}
        </SiteLink>
        <nav
          aria-label={t.nav.sections}
          className="absolute left-1/2 hidden -translate-x-1/2 items-center lg:flex"
        >
          {links.map((link) => (
            <SiteLink key={link.label} href={link.href} locale={locale} className={LINK}>
              {link.label}
            </SiteLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center">
          <LocaleSwitcher locale={locale} label={t.nav.language} />
          <ThemeToggle label={t.nav.theme} />
          {site.repoUrl && (
            <a
              href={site.repoUrl}
              aria-label={t.nav.github}
              className={cn(NAV_ICON, "hidden w-auto grid-flow-col gap-1.5 px-2 sm:grid")}
            >
              <svg viewBox="0 0 24 24" aria-hidden className="size-[18px] fill-current">
                <path d={siGithub.path} />
              </svg>
              {stars !== null && (
                <span className="flex items-center gap-1 text-sm font-medium tabular-nums">
                  <Star className="size-3.5 fill-(--sun) text-(--sun)" />
                  {new Intl.NumberFormat(locale, { notation: "compact" }).format(stars)}
                </span>
              )}
            </a>
          )}
          <MobileMenu links={menuLinks} locale={locale} label={t.nav.menu} />
          <span className="ml-2">
            {site.cloudOpen ? (
              <ConsoleLink
                className={CTA}
                getStarted={t.nav.getStarted}
                open={t.nav.open}
                icon={<ArrowUpRight className="size-3.5" />}
              />
            ) : (
              <SiteLink href="/#waitlist" locale={locale} className={CTA}>
                {t.nav.joinWaitlist}
              </SiteLink>
            )}
          </span>
        </div>
      </div>
    </header>
  );
}
