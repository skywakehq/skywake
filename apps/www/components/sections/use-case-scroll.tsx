"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  CodingArt,
  ContextArt,
  DocumentsArt,
  ExperimentsArt,
  KnowledgeArt,
  StorageArt,
} from "@/components/art/use-case-art";
import { CARD } from "@/components/ui/section";
import type { HomeMessages } from "@/content/messages";

// Same order as useCases.items. `id` is the page under /use-cases.
const ROWS = [
  { Art: KnowledgeArt, id: "knowledge-base" },
  { Art: ContextArt, id: "context-layer" },
  { Art: StorageArt, id: "sandboxes" },
  { Art: CodingArt, id: "coding-agents" },
  { Art: DocumentsArt, id: "document-agents" },
  { Art: ExperimentsArt, id: "rl" },
];

const number = (i: number) => String(i + 1).padStart(2, "0");

type UseCases = HomeMessages["useCases"];

export function UseCaseScroll({ u, href }: { u: UseCases; href: string }) {
  const [active, setActive] = useState(0);
  const blocks = useRef<(HTMLElement | null)[]>([]);

  // The text block crossing the middle of the screen picks which art the sticky card shows.
  useEffect(() => {
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    for (const el of blocks.current) if (el) seen.observe(el);
    return () => seen.disconnect();
  }, []);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-16 lg:grid-cols-2 lg:gap-16">
      <ol className="grid gap-16 lg:gap-0">
        {u.items.map((item, i) => {
          const { Art, id } = ROWS[i]!;
          return (
            <li
              key={item.name}
              data-index={i}
              ref={(el) => {
                blocks.current[i] = el;
              }}
              className={`flex flex-col justify-center transition-opacity duration-500 lg:min-h-[70vh] ${
                i === active ? "" : "lg:opacity-35"
              }`}
            >
              <p className="t-eyebrow text-muted-foreground">
                <span className="text-signal">{number(i)}</span>
                <span className="mx-2.5 text-muted-foreground/40">/</span>
                {item.name}
              </p>
              <h3 className="t-h2 t-regular mt-4 max-w-[18ch] text-foreground">{item.title}</h3>
              <p className="t-lead mt-4 max-w-[40ch] text-muted-foreground">{item.line}</p>
              <Link href={`${href}/${id}`} className="btn btn-secondary mt-8 w-fit">
                {u.cta} <ArrowRight className="size-4" />
              </Link>
              {/* Phones and tablets show the art under its own text instead of the sticky card. */}
              <div
                aria-hidden
                className={`${CARD} mt-8 grid min-h-72 place-items-center overflow-hidden px-4 py-10 lg:hidden`}
              >
                <Art />
              </div>
            </li>
          );
        })}
      </ol>

      <div aria-hidden className="hidden lg:block">
        <div
          className={`${CARD} sticky top-[calc(50vh-15rem)] grid h-[30rem] grid-rows-[auto_minmax(0,1fr)] overflow-hidden`}
        >
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <p className="t-eyebrow text-muted-foreground">
              <span className="text-signal">{number(active)}</span>
              <span className="mx-2.5 text-muted-foreground/40">/</span>
              {u.items[active]!.name}
            </p>
            <span className="flex gap-1.5">
              {u.items.map((item, i) => (
                <span
                  key={item.name}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i === active ? "w-5 bg-signal" : "w-1.5 bg-foreground/15"
                  }`}
                />
              ))}
            </span>
          </div>
          {/* All art sits in one cell so swapping never changes the card's size. */}
          <div className="grid place-items-center">
            {ROWS.map(({ Art }, i) => (
              <div
                key={i}
                className={`col-start-1 row-start-1 transition-[opacity,transform] duration-500 motion-reduce:transition-none ${
                  i === active ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0"
                }`}
              >
                <Art />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
