"use client";

import { useZero } from "@rocicorp/zero/react";
import { ChevronsUpDown, GitBranch, GitFork, GitMerge, History, Layers, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Link, navigate } from "@/components/shell/router";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@skywake/ui/components/alert-dialog";
import { envOf } from "@/lib/names";
import { type Check, filesOf, type Review, useChecks, useFleet } from "@/features/fleet/fleet";
import { settled } from "@/lib/mutate";
import { branchPath, envPath, nsPath } from "@/lib/paths";
import { usePeople } from "@/hooks/use-people";
import { cn } from "@skywake/ui/lib/utils";
import { mutators } from "@/zero/mutators";
import type { Change, Commit } from "@/zero/schema";
import { ForkDialog, useForkDialog } from "./branch-actions";
import { branchStatus } from "./branches";
import { FileDiff, Note } from "./diff";
import { FileBrowser } from "./file-browser";
import { Ago, Avatar, Button, Empty, Hash, Kbd, plural, Rows } from "@/components/kit";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/menu";
import { LiveDot, StatusPill } from "@/components/status";

const ALL = "all";
const ease = [0.22, 1, 0.36, 1] as const;

/**
 * One branch: its commits down the left, and the selected commit on the
 * right. "All changes" shows the branch against where it forked, which is
 * what a review judges. Picking an older commit is time travel: see the
 * files as they were, and fork a retry from there.
 */
export function BranchView({ ns, branch }: { ns: string; branch: string }) {
  const fleet = useFleet({ ns });
  const checks = useChecks(fleet.reviews, fleet.branches);
  const info = fleet.branches.find((b) => b.name === branch);
  const commits = fleet.commitsOf(ns, branch);
  const review = fleet.reviews.find((r) => r.branch.name === branch);
  const check = review && checks.get(review);
  const params = useSearchParams();
  const pathname = usePathname();
  const { fork, openFork, closeFork } = useForkDialog();

  const whole = !!review && commits.length > 1;
  const fallback = whole && review.state === "open" ? ALL : (info?.head ?? undefined);
  const at = params.get("at") ?? fallback;
  const tab = params.get("tab") ?? "changes";
  const path = params.get("path") ?? "";
  const selected = commits.find((c) => c.hash === at);
  const behind = selected ? commits.indexOf(selected) : 0;
  const forkPoint = commits.at(-1)?.parent ?? undefined;
  const steps = [...(whole ? [ALL] : []), ...commits.map((c) => c.hash)];

  function show(next: Record<string, string | null>) {
    const query = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    navigate(`${pathname}?${query}`, { replace: true });
  }

  // j and k step through the commits, as in a mail client.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest("input, textarea, [role=dialog]")) return;
      const step = event.key === "j" ? 1 : event.key === "k" ? -1 : 0;
      if (!step) return;
      const index = Math.max(0, steps.indexOf(at ?? ""));
      const next = steps[Math.min(steps.length - 1, Math.max(0, index + step))];
      if (next) show({ at: next, path: null });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!info) {
    if (fleet.loading) return <Rows count={8} className="pt-6" />;
    return (
      <Empty title={`No branch named ${branch}`}>
        It may have been rejected or deleted.{" "}
        <Link
          href={envPath(envOf(ns), "activity")}
          className="text-foreground underline-offset-4 hover:underline"
        >
          See activity
        </Link>
      </Empty>
    );
  }

  const agent =
    fleet.agents.find((a) => a.branch === branch && a.live) ??
    fleet.agents.find((a) => a.branch === branch);
  const status = branchStatus(info, review, check, agent);
  // Other tries of the same task: branches that differ only in the last part.
  const folder = branch.includes("/") ? branch.slice(0, branch.lastIndexOf("/") + 1) : null;
  const tries = folder
    ? fleet.branches
        .filter((b) => b.name.startsWith(folder) && !b.name.slice(folder.length).includes("/"))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    : [];
  const holds = agent?.claims.map((c) => c.path || "/") ?? [];

  return (
    <>
      <div className="shrink-0 border-b px-6 py-5">
        <div className="flex items-center gap-4">
          {agent ? (
            <Avatar name={agent.label} className="size-11 text-base ring-0" />
          ) : (
            <span className="grid size-11 shrink-0 place-items-center bg-muted text-muted-foreground">
              <GitBranch className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate font-mono text-[22px] leading-7 font-semibold tracking-[-0.02em]">
                {branch}
              </h1>
              <StatusPill status={status} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {info.forkedFrom && (
                <>
                  <GitFork className="size-3.5" />
                  from
                  <Link
                    href={branchPath(ns, info.forkedFrom)}
                    className="font-mono text-foreground hover:underline"
                  >
                    {info.forkedFrom}
                  </Link>
                  {forkPoint && (
                    <Link
                      href={branchPath(ns, info.forkedFrom, { at: forkPoint })}
                      className="hover:underline"
                    >
                      @ <Hash value={forkPoint} />
                    </Link>
                  )}
                </>
              )}
              {agent && (
                <>
                  <span className="text-faint">·</span>
                  {agent.live && <LiveDot />}
                  <span className="font-medium text-foreground">{agent.label}</span>
                  <span>
                    {agent.live ? "at work" : "ended"}{" "}
                    <Ago
                      time={agent.live ? (agent.last?.at ?? agent.created) : agent.expires}
                      className="text-muted-foreground"
                    />
                  </span>
                  {holds.length > 0 && (
                    <span>
                      · holds <span className="font-mono text-foreground">{holds.join(", ")}</span>
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {folder && tries.length > 1 && (
              <Menu>
                <MenuTrigger asChild>
                  <Button leadingIcon={Layers} trailingIcon={ChevronsUpDown}>
                    {tries.length} tries
                  </Button>
                </MenuTrigger>
                <MenuContent align="end" checkedIndex={tries.findIndex((t) => t.name === branch)}>
                  <MenuLabel className="font-mono text-xs font-normal text-muted-foreground">
                    {folder}
                  </MenuLabel>
                  {tries.map((t, i) => (
                    <MenuItem
                      key={t.name}
                      index={i}
                      label={t.name.slice(folder.length)}
                      checked={t.name === branch}
                      onSelect={() => navigate(branchPath(ns, t.name))}
                    />
                  ))}
                </MenuContent>
              </Menu>
            )}
            <Button leadingIcon={GitFork} onClick={() => openFork(branch)}>
              Fork
            </Button>
          </div>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {review?.state === "open" && <ReviewBar key="review" review={review} check={check} />}
      </AnimatePresence>
      <div className="flex min-h-0 flex-1">
        <Timeline
          commits={commits}
          whole={whole}
          selected={at}
          forkedFrom={info.forkedFrom}
          created={info.created}
          agentOf={fleet.agentOf}
          onSelect={(hash) => show({ at: hash, path: null })}
        />
        <section className="min-w-0 flex-1 overflow-y-auto">
          <AnimatePresence initial={false}>
            {selected && behind > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease }}
                className="overflow-hidden border-b bg-amber/5"
              >
                <div className="flex h-11 items-center gap-3 px-5 text-sm">
                  <History className="size-3.5 text-amber" />
                  <span>
                    Viewing <Hash value={selected.hash} className="text-foreground" />,{" "}
                    {plural(behind, "commit")} before the head.
                  </span>
                  <span className="ml-auto flex gap-2">
                    <Button onClick={() => show({ at: null, path: null })}>Back to head</Button>
                    <Button
                      leadingIcon={GitFork}
                      variant="primary"
                      onClick={() => openFork(branch, selected.hash)}
                    >
                      Fork from here
                    </Button>
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {at === ALL && review ? (
            <WholeHeader review={review} />
          ) : (
            selected && <CommitHeader commit={selected} agent={fleet.agentOf(selected)} />
          )}
          <div className="flex h-10 items-center gap-1 border-b px-4">
            {(["changes", "files"] as const).map((name) => (
              <button
                key={name}
                onClick={() => show({ tab: name, path: null })}
                className={cn(
                  "relative isolate h-7 rounded-md px-2.5 text-sm capitalize transition-colors",
                  tab === name
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === name && (
                  <motion.span
                    layoutId="branch-tab"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    className="absolute inset-0 -z-10 rounded-md bg-selected"
                  />
                )}
                {name}
              </button>
            ))}
            <span className="ml-auto hidden items-center gap-1 text-xs text-faint md:flex">
              <Kbd>J</Kbd> <Kbd>K</Kbd> to step through commits
            </span>
          </div>
          {tab === "files" && (
            <FileBrowser
              ns={ns}
              branch={branch}
              at={(at === ALL ? info.head : at) ?? ""}
              path={path}
              onOpen={(next) => show({ path: next })}
            />
          )}
          {tab === "changes" &&
            (at === ALL && info.head ? (
              <Changes
                ns={ns}
                branch={branch}
                changes={combine(commits)}
                at={info.head}
                parent={forkPoint}
                open={path}
                onOpen={(next) => show({ path: next })}
              />
            ) : selected ? (
              <Changes
                ns={ns}
                branch={branch}
                changes={selected.changes}
                at={selected.hash}
                parent={selected.parent}
                open={path}
                onOpen={(next) => show({ path: next })}
              />
            ) : (
              <Note>No recorded commits here yet. The Files tab shows the branch as it is.</Note>
            ))}
        </section>
      </div>
      {fork && <ForkDialog ns={ns} from={fork.from} at={fork.at} open onOpenChange={closeFork} />}
    </>
  );
}

/** What a run of commits did in all: a file added then changed is still added. */
function combine(commits: Commit[]): Change[] {
  const kinds = new Map<string, Change["kind"] | null>();
  for (const commit of [...commits].reverse()) {
    for (const change of commit.changes) {
      const before = kinds.get(change.path);
      if (before === "added") kinds.set(change.path, change.kind === "removed" ? null : "added");
      else if (before === "removed" && change.kind === "added") kinds.set(change.path, "modified");
      else kinds.set(change.path, change.kind);
    }
  }
  return [...kinds]
    .filter((entry): entry is [string, Change["kind"]] => entry[1] !== null)
    .map(([path, kind]) => ({ path, kind }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function Timeline({
  commits,
  whole,
  selected,
  forkedFrom,
  created,
  agentOf,
  onSelect,
}: {
  commits: Commit[];
  whole: boolean;
  selected?: string;
  forkedFrom?: string | null;
  created: number;
  agentOf: (commit?: Commit) => string | undefined;
  onSelect: (hash: string) => void;
}) {
  const people = usePeople();
  const item = (active: boolean) =>
    cn(
      "relative flex w-full gap-3 px-4 py-2 text-left transition-colors",
      active ? "bg-selected" : "hover:bg-accent",
    );
  return (
    <ol className="hidden w-[300px] shrink-0 overflow-y-auto border-r py-2 md:block">
      {whole && (
        <li>
          <button onClick={() => onSelect(ALL)} className={item(selected === ALL)}>
            <Layers className="mt-0.5 size-[13px] shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">All changes</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {plural(commits.length, "commit")} · {plural(filesOf(commits), "file")}
              </span>
            </span>
          </button>
        </li>
      )}
      <AnimatePresence initial={false}>
        {commits.map((commit, i) => (
          <motion.li
            key={commit.hash}
            layout="position"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25, ease }}
            className="relative"
          >
            <span
              aria-hidden
              className="absolute top-0 bottom-0 left-[23px] w-px bg-line-strong"
              style={i === 0 ? { top: 18 } : undefined}
            />
            <button
              onClick={() => onSelect(commit.hash)}
              className={item(commit.hash === selected)}
            >
              <span
                className={cn(
                  "relative mt-1.5 size-[9px] shrink-0 rounded-full border-[1.5px] border-foreground",
                  i === 0 ? "bg-foreground" : "bg-background",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  {commit.merged && <GitMerge className="size-3 shrink-0 text-muted-foreground" />}
                  <span className="truncate text-sm">{commit.message || "No message"}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{agentOf(commit) ?? people(commit.actor)}</span>
                  <Hash value={commit.hash} className="text-faint" />
                  <Ago time={commit.at} className="ml-auto" />
                </span>
              </span>
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
      {forkedFrom && (
        <li className="flex gap-3 px-4 py-2 text-xs text-muted-foreground">
          <GitFork className="mt-0.5 size-[9px] shrink-0" />
          <span>
            Forked from <span className="font-mono">{forkedFrom}</span> <Ago time={created} />
          </span>
        </li>
      )}
    </ol>
  );
}

function CommitHeader({ commit, agent }: { commit: Commit; agent?: string }) {
  const people = usePeople();
  return (
    <div className="border-b px-5 py-4">
      <p className="text-base font-medium">{commit.message || "No message"}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span className="text-foreground">{agent ?? people(commit.actor)}</span>
        {agent && <span>{people(commit.actor)}</span>}
        <Hash value={commit.hash} />
        <span>{new Date(commit.at).toLocaleString()}</span>
      </p>
    </div>
  );
}

function WholeHeader({ review }: { review: Review }) {
  return (
    <div className="border-b px-5 py-4">
      <p className="text-base font-medium">All changes on this branch</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Against <span className="font-mono text-foreground">{review.into}</span> where it forked,
        across {plural(review.commits.length, "commit")}.
      </p>
    </div>
  );
}

const SIGN = { added: "A", removed: "D", modified: "M" } as const;

function Changes({
  ns,
  branch,
  changes,
  at,
  parent,
  open,
  onOpen,
}: {
  ns: string;
  branch: string;
  changes: Change[];
  at: string;
  parent?: string | null;
  open: string;
  onOpen: (path: string) => void;
}) {
  if (!changes.length) return <Note>No files changed.</Note>;
  return (
    <ul>
      {changes.map((change) => (
        <li key={change.path} className="border-b border-border/60">
          <button
            onClick={() => onOpen(open === change.path ? "" : change.path)}
            className={cn(
              "flex h-9 w-full items-center gap-3 px-5 text-left transition-colors hover:bg-accent",
              open === change.path && "bg-accent",
            )}
          >
            <span
              className={cn(
                "w-3 font-mono text-xs",
                change.kind === "added" && "text-green",
                change.kind === "removed" && "text-destructive",
                change.kind === "modified" && "text-muted-foreground",
              )}
            >
              {SIGN[change.kind]}
            </span>
            <span className="truncate font-mono text-sm">{change.path}</span>
          </button>
          <AnimatePresence initial={false}>
            {open === change.path && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease }}
                className="overflow-hidden"
              >
                <div className="border-t border-border/60 bg-card py-2">
                  <FileDiff
                    ns={ns}
                    branch={branch}
                    path={change.path}
                    at={at}
                    parent={parent}
                    kind={change.kind}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </li>
      ))}
    </ul>
  );
}

/** Approve merges the branch into the one it was forked from; reject deletes it. */
function ReviewBar({ review, check }: { review: Review; check: Check }) {
  const zero = useZero();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const { ns } = review;
  const name = review.branch.name;
  const conflicts = check?.conflicts ?? [];

  async function approve() {
    setBusy(true);
    try {
      await settled(zero.mutate(mutators.branch.merge({ ns, into: review.into, from: name })));
      toast.success(`Merged ${name} into ${review.into}`);
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    }
    setBusy(false);
  }

  async function reject() {
    const result = zero.mutate(mutators.branch.remove({ ns, name }));
    navigate(nsPath(ns, "branches"));
    try {
      await settled(result);
      toast(`Rejected ${name}`);
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.25, ease }}
      className="shrink-0 overflow-hidden border-b"
    >
      <div
        className={cn(
          "flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 text-sm",
          conflicts.length ? "bg-destructive/[0.04]" : "bg-card",
        )}
      >
        <span
          className={cn(
            "grid size-7 place-items-center rounded-full border bg-background",
            conflicts.length ? "text-destructive" : "text-foreground",
          )}
        >
          {conflicts.length ? <X className="size-3.5" /> : <GitMerge className="size-3.5" />}
        </span>
        <span className="min-w-0">
          <span className="block font-medium">
            {!check
              ? "Checking the merge…"
              : conflicts.length
                ? `Conflicts with ${review.into}`
                : `Ready to merge into ${review.into}`}
          </span>
          <span className="block text-xs text-muted-foreground">
            {conflicts.length ? (
              <>
                In <span className="font-mono text-destructive">{conflicts.join(", ")}</span>. Fork
                a retry from {review.into}.
              </>
            ) : (
              <>
                {plural(review.commits.length, "commit")} ·{" "}
                {plural(filesOf(review.commits), "file")}
              </>
            )}
          </span>
        </span>
        <span className="ml-auto flex gap-2">
          <Button variant="danger" disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </Button>
          <Button
            leadingIcon={GitMerge}
            variant="primary"
            disabled={busy || !check || conflicts.length > 0}
            onClick={approve}
          >
            Approve and merge
          </Button>
        </span>
      </div>
      <AlertDialog open={rejecting} onOpenChange={setRejecting}>
        <AlertDialogContent className="sm:max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Reject {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The branch is deleted and its work is not merged. {review.into} does not change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={reject}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
