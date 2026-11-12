import Link from "fumadocs-core/link";
import { ArrowRight, ArrowUpRight, BookOpen, icons, type LucideIcon } from "lucide-react";
import { dirname } from "node:path";
import { createElement, type ReactNode } from "react";
import { InlineCode } from "@/components/inline-code";
import { source, type Page } from "@/lib/source";

/** Icons for generated pages, which have none of their own. */
const byType: Record<Page["type"], LucideIcon> = {
  docs: BookOpen,
  openapi: icons.Globe,
  cli: icons.SquareTerminal,
  sdk: icons.Braces,
};

function iconOf(page: Page): LucideIcon {
  const name = "icon" in page.data ? page.data.icon : undefined;
  return (typeof name === "string" && icons[name as keyof typeof icons]) || byType[page.type];
}

/** A page's icon: the one it names, or its kind's; `name` wins over both. */
export function PageIcon({
  page,
  name,
  className,
}: {
  page?: Page;
  name?: string;
  className?: string;
}) {
  const icon = (name && icons[name as keyof typeof icons]) || (page ? iconOf(page) : BookOpen);
  return createElement(icon, { className });
}

/** A grid of cards. */
export function Cards({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`not-prose my-6 grid gap-3 sm:grid-cols-2 ${wide ? "lg:grid-cols-3" : ""}`}>
      {children}
    </div>
  );
}

/**
 * A card that links to a page. Given only `href`, it takes the page's title,
 * description and icon, so a card never says something its page doesn't.
 */
export function PageCard({
  href,
  title,
  description,
  icon,
  children,
  from,
}: {
  href: string;
  title?: string;
  description?: string;
  icon?: string;
  children?: ReactNode;
  /** The page the card is on, to resolve `./x.mdx`. */
  from: Page;
}) {
  const external = /^https?:/.test(href);
  const found = external ? undefined : source.getPageByHref(href, { dir: dirname(from.path) });
  const target = found?.page;
  const text = children ?? description ?? target?.data.description;
  return (
    <Link
      href={target ? target.url + (found?.hash ? `#${found.hash}` : "") : href}
      className="group relative flex flex-col rounded-xl bg-muted/50 p-4 transition-colors duration-150 hover:bg-muted"
    >
      <span className="mb-3 grid size-8 place-items-center rounded-md bg-background text-muted-foreground transition-colors group-hover:text-foreground">
        <PageIcon page={target} name={icon} className="size-4" />
      </span>
      <span className="text-[12.5px] font-medium text-foreground">
        {title ?? target?.data.title ?? href}
      </span>
      {text && (
        <span className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">
          {typeof text === "string" ? <InlineCode text={text} /> : text}
        </span>
      )}
      {external ? (
        <ArrowUpRight className="absolute top-4 right-4 size-4 text-faint transition-colors group-hover:text-foreground" />
      ) : (
        <ArrowRight className="absolute top-4 right-4 size-4 -translate-x-1 text-faint opacity-0 transition-[opacity,translate] group-hover:translate-x-0 group-hover:opacity-100" />
      )}
    </Link>
  );
}
