"use client";

import {
  Activity as ActivityIcon,
  GitBranchPlus,
  GitCommitHorizontal,
  GitMerge,
  Lock,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "@/components/shell/router";
import { type ReactNode, useMemo, useState } from "react";
import { nameInEnv } from "@/lib/names";
import { useFleet } from "@/features/fleet/fleet";
import { branchPath, nsPath } from "@/lib/paths";
import { usePeople } from "@/hooks/use-people";
import type { Event } from "@/features/fleet/events";
import {
  Ago,
  Avatar,
  cx,
  Empty,
  Page,
  Panel,
  perDay,
  Rows,
  Stat,
  Stats,
  useNow,
  Glide,
  Choice,
} from "@/components/kit";

const ICONS: Partial<Record<Event["kind"], ReactNode>> = {
  commit: <GitCommitHorizontal />,
  merge: <GitMerge />,
  fork: <GitBranchPlus />,
  delete: <Trash2 />,
  protect: <Lock />,
  unprotect: <Lock />,
};

function day(time: number) {
  const date = new Date(time);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

const KINDS = {
  all: () => true,
  commits: (event: Event) => event.kind === "commit",
  merges: (event: Event) => event.kind === "merge",
  branches: (event: Event) => ["fork", "delete", "protect", "unprotect"].includes(event.kind),
};

/** Everything that happens in the environment, newest first, as it happens. */
export function Activity({ env }: { env: string }) {
  const fleet = useFleet({ env });
  const people = usePeople();
  const current = useNow();
  const [kind, setKind] = useState<keyof typeof KINDS>("all");
  const many = fleet.namespaces.length > 1;

  // Commits name their agent; other events only know the key.
  const agents = useMemo(() => {
    const names = new Map<string, string>();
    for (const commit of fleet.commits) {
      const name = fleet.agentOf(commit);
      if (name) names.set(commit.hash, name);
    }
    return names;
  }, [fleet]);

  const trend = (test: (event: Event) => boolean) =>
    perDay(
      fleet.events.filter(test).map((event) => event.at),
      14,
      current,
    );
  const commits = trend(KINDS.commits);
  const merges = trend(KINDS.merges);
  const forks = trend((event) => event.kind === "fork");
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

  // Day headings and events in one flat list, so new events can slide in
  // while the ones already shown stay still.
  const rows: ReactNode[] = [];
  let lastDay = "";
  for (const event of fleet.events.filter(KINDS[kind]).slice(0, 400)) {
    const heading = day(event.at);
    if (heading !== lastDay) {
      rows.push(
        <li
          key={`day ${heading}`}
          className="sticky top-0 z-20 border-b bg-background/95 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur"
        >
          {heading}
        </li>,
      );
      lastDay = heading;
    }
    const who = (event.head && agents.get(event.head)) || people(event.actor);
    rows.push(
      <motion.li
        key={event.id}
        layout="position"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        data-glide
        className="relative flex min-h-12 items-center gap-3 px-4 text-sm"
      >
        <span className="absolute top-0 bottom-0 left-[29px] w-px bg-border" />
        <span
          className={cx(
            "relative z-10 grid size-7 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground [&_svg]:size-3.5",
            event.kind === "merge" && "border-green/40 bg-green/10 text-green",
            event.kind === "delete" && "text-destructive",
          )}
        >
          {ICONS[event.kind] ?? <ActivityIcon />}
        </span>
        <Avatar name={who} className="size-5 ring-0 max-sm:hidden" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{who}</span>{" "}
          <span className="text-muted-foreground">{describe(event, many)}</span>
        </span>
        <Ago time={event.at} />
      </motion.li>,
    );
  }

  return (
    <Page eyebrow={env} title="Activity" description="Commits, forks and merges, as they happen.">
      <Stats>
        <Stat label="Commits" value={sum(commits)} note="last 14 days" trend={commits} />
        <Stat label="Merges" value={sum(merges)} note="last 14 days" trend={merges} />
        <Stat label="Forks" value={sum(forks)} note="last 14 days" trend={forks} />
        <Stat
          label="Deleted"
          value={fleet.events.filter((event) => event.kind === "delete").length}
          note="rejected work"
        />
      </Stats>

      <Panel
        title="Timeline"
        action={
          <Choice
            value={kind}
            onChange={setKind}
            options={Object.keys(KINDS).map((name) => ({
              value: name as keyof typeof KINDS,
              label: name[0]!.toUpperCase() + name.slice(1),
            }))}
          />
        }
      >
        {rows.length ? (
          // Mounted once there are events, so those already there don't animate.
          <Glide>
            <ol className="max-h-[70vh] overflow-y-auto">
              <AnimatePresence initial={false}>{rows}</AnimatePresence>
            </ol>
          </Glide>
        ) : fleet.loading ? (
          <Rows count={10} />
        ) : (
          <Empty title="No activity yet" columns={["Event", "Filesystem", "When"]}>
            Commits, forks and merges show here the moment they land.
          </Empty>
        )}
      </Panel>
    </Page>
  );
}

function describe(event: Event, many: boolean): ReactNode {
  const { ns } = event;
  const branch = (name: string) => (
    <Link href={branchPath(ns, name)} className="font-mono text-foreground hover:underline">
      {name}
    </Link>
  );
  const where = many ? (
    <>
      {" "}
      in{" "}
      <Link href={nsPath(ns)} className="font-mono hover:underline">
        {nameInEnv(ns)}
      </Link>
    </>
  ) : null;
  switch (event.kind) {
    case "commit":
      return (
        <>
          committed to {branch(event.branch)}
          {where}
        </>
      );
    case "merge":
      return (
        <>
          merged {branch(event.from ?? "")} into {branch(event.branch)}
          {where}
        </>
      );
    case "fork":
      return (
        <>
          forked {branch(event.branch)}
          {where}
        </>
      );
    case "delete":
      return (
        <>
          deleted <span className="font-mono">{event.branch}</span>
          {where}
        </>
      );
    case "protect":
      return <>protected {branch(event.branch)}</>;
    case "unprotect":
      return <>unprotected {branch(event.branch)}</>;
    case "create":
      return (
        <>
          created{" "}
          <Link href={nsPath(ns)} className="font-mono text-foreground hover:underline">
            {nameInEnv(ns)}
          </Link>
        </>
      );
  }
}
