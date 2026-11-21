"use client";

import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/components/shell/router";
import { nameInEnv } from "@/lib/names";
import { nsPath } from "@/lib/paths";
import { useChecks, useFleet } from "@/features/fleet/fleet";
import { Ago, Button, DiskMark, Empty, Kbd, Page, plural } from "@/components/kit";
import { Connect } from "./connect";
import { NewNamespace } from "./new-namespace";

type Card = {
  name: string;
  /** Finished work waiting to be merged, and how much of it conflicts. */
  waiting: number;
  conflicts: number;
  updated: number;
};

/** An environment's home: a folder per disk, the ones that need you first. */
export function Namespaces({ env }: { env: string }) {
  const fleet = useFleet({ env });
  const checks = useChecks(fleet.reviews, fleet.branches);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const search = useRef<HTMLInputElement>(null);

  const cards = useMemo(() => {
    const cards = new Map<string, Card>(
      fleet.namespaces.map((n) => [
        n.name,
        {
          name: n.name,
          waiting: 0,
          conflicts: 0,
          updated: n.created,
        },
      ]),
    );
    for (const review of fleet.reviews) {
      const card = cards.get(review.ns);
      if (!card || review.state === "merged") continue;
      card.waiting++;
      if (checks.get(review)?.conflicts.length) card.conflicts++;
    }
    for (const branch of fleet.branches) {
      const card = cards.get(branch.namespace);
      if (!card) continue;
      card.updated = Math.max(card.updated, branch.updated);
    }
    for (const commit of fleet.commits) {
      const card = cards.get(commit.namespace);
      if (card) card.updated = Math.max(card.updated, commit.at);
    }
    const rank = (card: Card) => (card.waiting ? 1 : 0);
    return [...cards.values()].sort((a, b) => rank(b) - rank(a) || b.updated - a.updated);
  }, [fleet, checks]);

  // Nothing has happened here yet: show how to connect an agent instead of zeros.
  const fresh =
    !fleet.loading &&
    cards.length > 0 &&
    !fleet.commits.length &&
    fleet.branches.every((branch) => branch.protected);
  const shown = cards.filter((card) => nameInEnv(card.name).includes(filter.trim()));

  // `/` filters and `c` makes a new disk, as in Linear.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || creating) return;
      const target = event.target as HTMLElement;
      if (target === search.current && event.key === "Escape") {
        setFilter("");
        search.current.blur();
      }
      if (target.closest("input, textarea, [role=dialog]")) return;
      if (event.key === "/" || event.key === "c") event.preventDefault();
      if (event.key === "/") search.current?.focus();
      if (event.key === "c") setCreating(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Page
      eyebrow={env}
      title="Disks"
      actions={
        <>
          <Button
            leadingIcon={Plus}
            variant="primary"
            size="default"
            onClick={() => setCreating(true)}
          >
            New disk
          </Button>
          <label className="flex h-8 w-52 items-center gap-2 rounded-full bg-hover px-3 text-muted-foreground transition-colors focus-within:bg-active max-sm:w-36">
            <Search className="size-3.5 shrink-0" />
            <input
              ref={search}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {!filter && <Kbd className="max-sm:hidden">/</Kbd>}
          </label>
        </>
      }
    >
      {fresh && <Connect ns={cards[0]!.name} />}

      {fleet.loading && !cards.length ? (
        <div className={GRID}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel h-40 animate-pulse" />
          ))}
        </div>
      ) : shown.length ? (
        <div className={GRID}>
          {shown.map((card) => (
            <DiskFolder key={card.name} card={card} />
          ))}
        </div>
      ) : (
        <Empty title={filter ? `No disk matches “${filter}”` : `No disks in ${env}`}>
          <p>{filter ? "Try another name." : "Make one, mount it, and point your agents at it."}</p>
          {!filter && (
            <Button
              leadingIcon={Plus}
              variant="primary"
              className="mt-4"
              onClick={() => setCreating(true)}
            >
              New disk
            </Button>
          )}
        </Empty>
      )}
      <NewNamespace env={env} open={creating} onOpenChange={setCreating} />
    </Page>
  );
}

const GRID = "-mx-3 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2";

function DiskFolder({ card }: { card: Card }) {
  return (
    <Link
      href={nsPath(card.name)}
      className="flex flex-col items-center gap-3 rounded-2xl px-3 py-5 text-center transition-colors hover:bg-(--panel)"
    >
      <DiskMark className="h-20" />
      <div className="grid w-full justify-items-center gap-1.5">
        <span className="max-w-full truncate text-sm font-medium">{nameInEnv(card.name)}</span>
        <span className="flex h-5 items-center gap-1.5 text-xs text-muted-foreground">
          <State card={card} />
        </span>
      </div>
    </Link>
  );
}

/** The one thing worth saying about a disk: what it needs, or when it last changed. */
function State({ card }: { card: Card }) {
  if (card.conflicts)
    return <span className="text-destructive">{plural(card.conflicts, "conflict")}</span>;
  if (card.waiting)
    return (
      <>
        <span className="size-1.5 rounded-full bg-signal" />
        Ready to merge
      </>
    );
  return <Ago time={card.updated} />;
}
