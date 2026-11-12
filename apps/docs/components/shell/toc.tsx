"use client";

import { AnchorProvider, type TOCItemType, TOCItem } from "fumadocs-core/toc";

/** On this page: the headings, the one in view marked. */
export function Toc({ items }: { items: TOCItemType[] }) {
  if (items.length === 0) return null;
  return (
    <AnchorProvider toc={items}>
      <nav className="sticky top-0 hidden max-h-[calc(100dvh-4rem)] w-52 shrink-0 overflow-y-auto py-10 text-sm xl:block">
        <p className="mb-3 text-xs font-medium text-muted-foreground">On this page</p>
        <ul className="border-l">
          {items.map((item) => (
            <li key={item.url}>
              <TOCItem
                href={item.url}
                style={{ paddingLeft: `${0.75 + (item.depth - 2) * 0.75}rem` }}
                className="-ml-px block border-l border-transparent py-1 text-muted-foreground transition-colors hover:text-foreground data-[active=true]:border-foreground data-[active=true]:text-foreground"
              >
                {item.title}
              </TOCItem>
            </li>
          ))}
        </ul>
      </nav>
    </AnchorProvider>
  );
}
