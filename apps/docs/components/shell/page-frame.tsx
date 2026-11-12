import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";
import Link from "fumadocs-core/link";
import { findNeighbour } from "fumadocs-core/page-tree";
import type { TOCItemType } from "fumadocs-core/toc";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { PageIcon } from "@/components/cards";
import { InlineCode } from "@/components/inline-code";
import { source, type Page } from "@/lib/source";
import { Toc } from "./toc";

/** One page in the shell: its title, its body, what's on it, and its neighbours. */
export function PageFrame({
  page,
  toc = [],
  wide = false,
  header = true,
  children,
}: {
  page: Page;
  toc?: TOCItemType[];
  wide?: boolean;
  header?: boolean;
  children: ReactNode;
}) {
  const tree = source.getPageTree();
  // A guide that ends with its own "Next" cards needs no second way on.
  const ownNext = toc.some((item) => item.url === "#next");
  const { previous, next } = ownNext ? {} : findNeighbour(tree, page.url);
  // The section the page is in, named above its title.
  const section = getBreadcrumbItems(page.url, tree)[0]?.name;
  return (
    <div className="flex justify-center gap-12 px-6 md:px-10">
      <article className={`min-w-0 flex-1 py-10 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
        {header && (
          <header className="mb-8">
            <div className="mb-4 flex items-center gap-2.5 text-sm text-muted-foreground">
              <span className="grid size-7 place-items-center rounded-lg border bg-card text-foreground">
                <PageIcon page={page} className="size-3.5" />
              </span>
              {section}
            </div>
            <h1 className="sw-title">{page.data.title}</h1>
            {page.data.description && (
              <p className="mt-3 text-lg text-pretty text-muted-foreground">
                <InlineCode text={page.data.description} />
              </p>
            )}
          </header>
        )}
        <div className="prose min-w-0">{children}</div>
        {(previous || next) && (
          <nav className="mt-16 grid grid-cols-2 gap-3 border-t pt-6 text-sm">
            {previous ? (
              <Neighbour href={previous.url} label="Previous" name={previous.name} />
            ) : (
              <span />
            )}
            {next && <Neighbour href={next.url} label="Next" name={next.name} end />}
          </nav>
        )}
      </article>
      {!wide && <Toc items={toc} />}
    </div>
  );
}

function Neighbour({
  href,
  label,
  name,
  end,
}: {
  href: string;
  label: string;
  name: ReactNode;
  end?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex flex-col gap-1 rounded-lg border px-4 py-3 transition-colors hover:bg-accent ${end ? "col-start-2 items-end text-right" : ""}`}
    >
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {!end && <ArrowLeft className="size-3" />}
        {label}
        {end && <ArrowRight className="size-3" />}
      </span>
      <span className="font-medium">{name}</span>
    </Link>
  );
}
