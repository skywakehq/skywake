import { ArrowUpRight } from "lucide-react";

import { Logo } from "@skywake/ui/components/logo";
import { SiteLink } from "@/components/ui/site-link";
import { navLinks } from "@/content/navigation";
import { site } from "@/content/site";
import { ThemeToggle } from "./theme-toggle";

const LINK =
  "t-small rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground";

export function Nav() {
  return (
    <header className="sticky top-3 z-40 mx-auto mt-3 w-full max-w-6xl">
      <div className="flex h-14 items-center gap-1 rounded-2xl border border-border bg-card/85 pr-2 pl-4 backdrop-blur-md">
        <SiteLink
          href="/"
          className="t-body mr-3 flex items-center gap-2 font-medium tracking-[-0.02em] text-foreground"
        >
          <Logo className="size-[18px]" />
          {site.name}
        </SiteLink>
        <nav aria-label="Sections" className="ml-4 hidden items-center md:flex">
          {navLinks.map((link) => (
            <SiteLink key={link.label} href={link.href} className={LINK}>
              {link.label}
            </SiteLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          {site.repoUrl && (
            <a href={site.repoUrl} className={`${LINK} hidden sm:block`}>
              GitHub
            </a>
          )}
          <a href={site.docsUrl} className="btn btn-sm btn-primary">
            Get started <ArrowUpRight className="size-3.5" />
          </a>
        </div>
      </div>
    </header>
  );
}
