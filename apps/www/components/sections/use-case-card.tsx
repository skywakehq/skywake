"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { UseCaseArt } from "@/components/art/use-case-art";
import { CARD } from "@/components/ui/section";

// The art stays still until the card is hovered or focused, so a grid of cards is calm.
export function UseCaseCard({
  id,
  name,
  title,
  line,
  href,
  cta = "See how it works",
}: {
  id: string;
  name: string;
  title: string;
  line: string;
  href: string;
  cta?: string;
}) {
  const [play, setPlay] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setPlay(true)}
      onMouseLeave={() => setPlay(false)}
      onFocus={() => setPlay(true)}
      onBlur={() => setPlay(false)}
      className={`${CARD} reveal flex h-full flex-col overflow-hidden transition-colors hover:border-foreground/20`}
    >
      <div aria-hidden className="grid h-64 place-items-center border-b border-border px-4">
        <UseCaseArt id={id} play={play} />
      </div>
      <div className="flex flex-1 flex-col p-6">
        <p className="t-eyebrow text-muted-foreground">{name}</p>
        <h3 className="t-h3 mt-3 text-foreground">{title}</h3>
        <p className="t-body mt-2 text-muted-foreground">{line}</p>
        <span className="t-small mt-auto flex items-center gap-1.5 pt-6 font-medium text-foreground">
          {cta} <ArrowRight className="size-4 text-signal" />
        </span>
      </div>
    </Link>
  );
}
