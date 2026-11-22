import type { ReactNode } from "react";
import { ArrowUpRight, Star } from "lucide-react";

import { Logo } from "@skywake/ui/components/logo";
import { SiteLink } from "@/components/ui/site-link";
import type { HomeMessages } from "@/content/messages";
import { site } from "@/content/site";
import { githubStars } from "@/lib/github-stars";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LINK =
  "group inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";

// The footer's width: the frame's, with the page's side gutter.
function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}>{children}</div>;
}

export async function Footer({ locale, messages: t }: { locale: Locale; messages: HomeMessages }) {
  const stars = site.repoUrl ? await githubStars(site.repoUrl) : null;
  const columns = [
    {
      title: t.footer.product,
      links: [
        { href: "/use-cases", label: t.footer.useCases },
        { href: "/pricing", label: t.nav.pricing },
      ],
    },
    {
      title: t.footer.project,
      links: [
        { href: site.docsUrl, label: t.nav.docs },
        { href: `${site.docsUrl}/agent-filesystem`, label: t.footer.agentFilesystem },
        { href: "/#open-source", label: t.footer.openSource },
      ],
    },
    {
      title: t.footer.legal,
      links: [
        { href: "/privacy", label: t.footer.privacy },
        { href: "/terms", label: t.footer.terms },
      ],
    },
  ];

  return (
    <footer className="overflow-hidden">
      <div aria-hidden className="mt-24 lg:mt-32" />
      <Container className="@container">
        <div className="grid gap-12 pt-14 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
          <div className="flex flex-col gap-4">
            <SiteLink
              href="/"
              locale={locale}
              className="flex w-fit items-center gap-2 text-[17px] font-medium tracking-[-0.02em] text-foreground"
            >
              <Logo className="size-5" />
              {site.name}
            </SiteLink>
            <p className="max-w-[32ch] text-sm text-muted-foreground">{t.footer.blurb}</p>
          </div>
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="text-sm font-medium text-foreground">{column.title}</p>
              <ul className="mt-4 grid gap-3">
                {column.links.map(({ href, label }) => (
                  <li key={label}>
                    <SiteLink href={href} locale={locale} className={LINK}>
                      {label}
                    </SiteLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </Container>

      <div className="mt-14">
        <Container className="flex flex-wrap items-center justify-between gap-4 py-5">
          <p className="text-sm text-muted-foreground">© 2026 {site.name} · Apache-2.0</p>
          <div className="flex items-center gap-3">
            {site.repoUrl && (
              <a href={site.repoUrl} className={LINK}>
                {t.footer.star}
                {stars === null ? (
                  <ArrowUpRight className="size-3.5" />
                ) : (
                  <span className="flex items-center gap-1 tabular-nums">
                    <Star className="size-3.5 fill-(--sun) text-(--sun)" />
                    {new Intl.NumberFormat(locale, { notation: "compact" }).format(stars)}
                  </span>
                )}
              </a>
            )}
          </div>
        </Container>
      </div>

      <Container className="@container">
        <p
          aria-hidden
          className="footer-word -mb-[0.24em] text-center leading-none font-medium tracking-[-0.06em] select-none"
        >
          {site.name}
        </p>
      </Container>
    </footer>
  );
}
