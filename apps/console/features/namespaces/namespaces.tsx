"use client";

import { LayoutGrid, List, Plus, Search, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "@/components/shell/router";
import { nameInEnv } from "@/lib/names";
import { nsPath } from "@/lib/paths";
import { useChecks, useFleet } from "@/features/fleet/fleet";
import { city } from "@/features/environments/regions";
import type { Commit } from "@/zero/schema";
import {
  Ago,
  Avatars,
  Button,
  Choice,
  cx,
  Empty,
  Glide,
  Kbd,
  Orb,
  Page,
  perDay,
  plural,
  Spark,
  useNow,
} from "@/components/kit";
import { Connect } from "./connect";
import { NewNamespace } from "./new-namespace";

const DAYS = 28;
const VIEW = "skywake:filesystems-view";

type View = "grid" | "list";

function storedView(): View {
  try {
    return localStorage.getItem(VIEW) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

/** Grid or list, remembered in this browser only. */
function useView() {
  const stored = useSyncExternalStore(
    () => () => {},
    storedView,
    () => "grid" as View,
  );
  const [picked, setPicked] = useState<View>();
  function choose(next: View) {
    setPicked(next);
    try {
      localStorage.setItem(VIEW, next);
    } catch {}
  }
  return [picked ?? stored, choose] as const;
}

type Card = {
  name: string;
  region: string;
  /** Finished work waiting to be merged, and how much of it conflicts. */
  waiting: number;
  conflicts: number;
  agents: string[];
  branches: number;
  merged: number;
  commits: number[];
  last?: Commit;
  updated: number;
};

/** An environment's home: a card per disk, the ones that need you first. */
export function Namespaces({ env }: { env: string }) {
  const fleet = useFleet({ env });
  const checks = useChecks(fleet.reviews, fleet.branches);
  const current = useNow();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [view, setView] = useView();
  const search = useRef<HTMLInputElement>(null);

  const cards = useMemo(() => {
    const cards = new Map<string, Card & { times: number[] }>(
      fleet.namespaces.map((n) => [
        n.name,
        {
          name: n.name,
          region: n.region,
          waiting: 0,
          conflicts: 0,
          agents: [],
          branches: 0,
          merged: 0,
          commits: [],
          times: [],
          updated: n.created,
        },
      ]),
    );
    const working = new Set<string>();
    for (const agent of fleet.agents) {
      const card = cards.get(agent.namespace);
      if (!card || !agent.live) continue;
      card.agents.push(agent.label);
      if (agent.branch) working.add(`${agent.namespace}\n${agent.branch}`);
    }
    const merged = new Set<string>();
    for (const review of fleet.reviews) {
      const id = `${review.ns}\n${review.branch.name}`;
      const card = cards.get(review.ns);
      if (!card) continue;
      if (review.state === "merged") {
        merged.add(id);
        card.merged++;
      } else if (!working.has(id)) {
        card.waiting++;
        if (checks.get(review)?.conflicts.length) card.conflicts++;
      }
    }
    for (const branch of fleet.branches) {
      const card = cards.get(branch.namespace);
      if (!card) continue;
      card.updated = Math.max(card.updated, branch.updated);
      if (!branch.protected && !merged.has(`${branch.namespace}\n${branch.name}`)) card.branches++;
    }
    for (const commit of fleet.commits) {
      const card = cards.get(commit.namespace);
      if (!card) continue;
      card.times.push(commit.at);
      if (!card.last || commit.at > card.last.at) card.last = commit;
    }
    const rank = (card: Card) => (card.waiting ? 2 : card.agents.length ? 1 : 0);
    return [...cards.values()]
      .map((card) => ({ ...card, commits: perDay(card.times, DAYS, current) }))
      .sort((a, b) => rank(b) - rank(a) || b.updated - a.updated);
  }, [fleet, checks, current]);

  // Nothing has happened here yet: show how to connect an agent instead of zeros.
  const fresh =
    !fleet.loading &&
    cards.length > 0 &&
    !fleet.commits.length &&
    !fleet.agents.length &&
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
      description="Each one has its own branches and history. Agents fork it, work, and merge back."
      actions={
        <>
          <Choice
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: "Grid", icon: LayoutGrid },
              { value: "list", label: "List", icon: List },
            ]}
          />
          <label className="flex h-8 w-52 items-center gap-2 rounded-lg bg-muted/70 px-2.5 text-muted-foreground transition-colors focus-within:bg-muted max-sm:w-36">
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
          <Button
            leadingIcon={Plus}
            variant="primary"
            size="default"
            onClick={() => setCreating(true)}
          >
            New disk
          </Button>
        </>
      }
    >
      {fresh && <Connect ns={cards[0]!.name} />}

      {fleet.loading && !cards.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-52 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      ) : shown.length && view === "list" ? (
        <Glide className="-mx-4 min-w-0 divide-y divide-border/60">
          {shown.map((card) => (
            <DiskRow key={card.name} card={card} />
          ))}
        </Glide>
      ) : shown.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((card) => (
            <DiskCard key={card.name} card={card} />
          ))}
        </div>
      ) : (
        <div className="-mx-5">
          <Empty
            title={filter ? `No disk matches “${filter}”` : `No disks in ${env}`}
            columns={["Disk", "Branches", "Updated"]}
          >
            <p>
              {filter
                ? "Try another name."
                : "Each one is a set of files that agents fork, change and merge back."}
            </p>
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
        </div>
      )}
      <NewNamespace env={env} open={creating} onOpenChange={setCreating} />
    </Page>
  );
}

function DiskCard({ card }: { card: Card }) {
  const total = card.commits.reduce((a, b) => a + b, 0);
  const who = card.agents.length ? card.agents : card.last?.agent ? [card.last.agent] : [];
  const facts = factsOf(card);

  return (
    <Link
      href={nsPath(card.name)}
      className="group flex h-full flex-col rounded-xl bg-muted/50 p-5 transition-colors hover:bg-muted"
    >
      <div className="flex items-start gap-3">
        <Orb name={card.name} className="size-9" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{nameInEnv(card.name)}</div>
          <div className="truncate text-xs text-faint">
            {plural(card.branches, "branch")} · {city(card.region)}
          </div>
        </div>
        <State card={card} />
      </div>

      {total > 0 ? (
        <div className="mt-5">
          <Spark values={card.commits} className="h-10 w-full" />
          <div className="mt-1.5 text-micro text-faint tabular-nums">
            {plural(total, "commit")} in {DAYS} days
          </div>
        </div>
      ) : (
        <p className="mt-5 text-xs text-faint">No changes in the last {DAYS} days</p>
      )}

      {facts.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground tabular-nums">
          {facts.map(([value, label], i) => (
            <span key={label}>
              {i > 0 && " · "}
              <span className="font-medium text-foreground">{value}</span> {label}
            </span>
          ))}
        </p>
      )}

      <div className="mt-auto flex items-center gap-2.5 pt-5 text-xs">
        <Avatars names={who} />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {card.last?.message ?? "No commits yet"}
        </span>
        <Ago time={card.last?.at ?? card.updated} />
      </div>
    </Link>
  );
}

function factsOf(card: Card) {
  const all: [number, string][] = [
    [card.waiting, "ready to merge"],
    [card.agents.length, card.agents.length === 1 ? "agent working" : "agents working"],
    [card.merged, "merged"],
  ];
  return all.filter(([value]) => value > 0);
}

function DiskRow({ card }: { card: Card }) {
  const total = card.commits.reduce((a, b) => a + b, 0);
  const counts: [number, string][] = [
    ...factsOf(card),
    [card.branches, card.branches === 1 ? "branch" : "branches"],
  ];

  return (
    <Link href={nsPath(card.name)} data-glide className="group flex h-14 items-center gap-4 px-4">
      <Orb name={card.name} />
      <span className="w-44 shrink-0 truncate text-sm font-medium max-sm:w-auto max-sm:flex-1">
        {nameInEnv(card.name)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground max-sm:hidden">
        {card.last?.message ?? "No commits yet"}
      </span>
      <span
        title={card.region}
        className="w-28 shrink-0 truncate text-xs text-muted-foreground max-md:hidden"
      >
        {city(card.region)}
      </span>
      <span className="flex w-60 shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums max-lg:hidden">
        {counts.map(([value, label]) =>
          value ? (
            <span key={label}>
              <span className="text-foreground">{value}</span> {label}
            </span>
          ) : null,
        )}
      </span>
      <span title={plural(total, "commit")} className="max-md:hidden">
        <Spark values={card.commits} className="h-5 w-20" />
      </span>
      <span className="flex w-32 shrink-0 justify-end">
        <State card={card} />
      </span>
      <Ago time={card.last?.at ?? card.updated} className="w-8 text-right" />
    </Link>
  );
}

/** What the disk needs, in a word, with a dot so it never rests on colour alone. */
function State({ card }: { card: Card }) {
  if (card.conflicts)
    return (
      <span className="inline-flex h-6 shrink-0 items-center gap-1.5 bg-destructive/10 px-2 text-xs font-medium text-destructive">
        <TriangleAlert className="size-3" /> {plural(card.conflicts, "conflict")}
      </span>
    );
  if (!card.waiting && !card.agents.length) return null;
  const [label, dot] = card.waiting ? ["Ready to merge", "bg-signal"] : ["Working", "bg-green"];
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cx("size-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}
