import { ArrowUpRight, BookOpen, Scale } from "lucide-react";
import {
  Building2,
  ChartNoAxesColumn,
  CreditCard,
  FileText,
  HardDrive,
  Heart,
  Layers,
  Search,
  Shield,
  Sparkles,
} from "lucide-react";
import { siGithub } from "simple-icons";

import { Logo } from "@skywake/ui/components/logo";
import { BrandIcon } from "@/components/ui/brand-icon";
import { Container, Hatch } from "@/components/ui/section";
import { SiteLink } from "@/components/ui/site-link";
import { getMessages, type HomeMessages } from "@/content/messages";
import { site } from "@/content/site";
import { defaultLocale, type Locale } from "@/lib/i18n";
import { ThemeToggle } from "./theme-toggle";

const LINK =
  "t-small group inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground";

const ICON_BUTTON =
  "grid size-9 place-items-center rounded-md bg-background text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground";

export function Footer({
  locale = defaultLocale,
  messages,
}: {
  locale?: Locale;
  messages?: HomeMessages;
}) {
  const t = messages ?? getMessages(locale);
  const columns = [
    {
      title: t.footer.product,
      links: [
        { href: "/filesystem", label: t.nav.filesystem, icon: HardDrive },
        { href: "/search", label: t.nav.search, icon: Search },
        { href: "/agents", label: t.footer.agents, icon: Sparkles },
        { href: "/use-cases", label: t.footer.useCases, icon: Layers },
        { href: "/pricing", label: t.nav.pricing, icon: CreditCard },
        { href: "/enterprise", label: t.footer.enterprise, icon: Building2 },
      ],
    },
    {
      title: t.footer.project,
      links: [
        { href: site.docsUrl, label: t.nav.docs, icon: BookOpen },
        { href: "/#benchmarks", label: t.nav.benchmarks, icon: ChartNoAxesColumn },
        { href: "/#open-source", label: t.footer.openSource, icon: Heart },
      ],
    },
    {
      title: t.footer.legal,
      links: [
        { href: "/privacy", label: t.footer.privacy, icon: Shield },
        { href: "/terms", label: t.footer.terms, icon: FileText },
      ],
    },
  ];

  return (
    <footer className="overflow-hidden">
      <Hatch className="mt-24 lg:mt-32" />
      <Container className="@container">
        <div className="grid gap-12 pt-14 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
          <div className="flex flex-col gap-6">
            <SiteLink
              href="/"
              locale={locale}
              className="t-body flex w-fit items-center gap-2 font-medium tracking-[-0.02em] text-foreground"
            >
              <Logo className="size-5" />
              {site.name}
            </SiteLink>
            <p className="t-small max-w-[32ch] text-muted-foreground">{t.footer.blurb}</p>
            <div className="flex items-center gap-2">
              {site.repoUrl && (
                <a href={site.repoUrl} aria-label={t.nav.github} className={ICON_BUTTON}>
                  <BrandIcon icon={siGithub} />
                </a>
              )}
              <a href={site.docsUrl} aria-label={t.nav.docs} className={ICON_BUTTON}>
                <BookOpen className="size-4" strokeWidth={1.75} />
              </a>
            </div>
          </div>
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="t-eyebrow text-muted-foreground/70">{column.title}</p>
              <ul className="mt-5 grid gap-3.5">
                {column.links.map(({ href, label, icon: Icon }) => (
                  <li key={label}>
                    <SiteLink href={href} locale={locale} className={LINK}>
                      <Icon
                        className="size-3.5 text-muted-foreground/60 transition-colors group-hover:text-signal"
                        strokeWidth={1.75}
                      />
                      {label}
                    </SiteLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </Container>

      <div className="mt-14 border-y border-border">
        <Container className="flex flex-wrap items-center justify-between gap-4 py-5">
          <p className="t-small flex items-center gap-2 text-muted-foreground">
            <Scale className="size-3.5" strokeWidth={1.75} />© 2026 {site.name} · Apache-2.0
          </p>
          <div className="flex items-center gap-3">
            {site.repoUrl && (
              <a href={site.repoUrl} className={LINK}>
                {t.footer.star}
                <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            )}
            <ThemeToggle />
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
