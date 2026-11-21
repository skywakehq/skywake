"use client";

import { useZero } from "@rocicorp/zero/react";
import { ChevronsUpDown, FolderOpen, GitBranch, GitFork, GitMerge, History, Layers, X } from "lucide-react";
import { Link, navigate } from "@/components/shell/router";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
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
import { cn } from "@skywake/ui/lib/utils";
import { mutators } from "@/zero/mutators";
import { ForkDialog, useForkDialog } from "./branch-actions";
import { Changes, combine } from "./changes";
import { CommitList } from "./commit-list";
import { Note } from "./diff";
import { FileBrowser } from "./file-browser";
import { Ago, Button, Empty, Hash, plural, Rows, TabNav } from "@/components/kit";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/menu";

type View = "changes" | "history" | "files";

/**
 * One branch. A fork opens on its changes against where it came from, with
 * merge and reject beside them; any branch has its history, commit by
 * commit, and its files at any of those commits.
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

  const views: View[] = [...(review ? (["changes"] as const) : []), "history", "files"];
  const asked = params.get("tab") as View | null;
  const view: View = asked && views.includes(asked) ? asked : views[0]!;
  const path = params.get("path") ?? "";
  const at = params.get("at");
  const forkPoint = commits.at(-1)?.parent ?? undefined;

  function show(next: Record<string, string | null>) {
    const query = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    navigate(`${pathname}?${query}`, { replace: true });
  }

  if (!info) {
    if (fleet.loading) return <Rows count={8} className="px-8 pt-8" />;
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

  const folder = branch.includes("/") ? branch.slice(0, branch.lastIndexOf("/") + 1) : null;
  const tries = folder
    ? fleet.branches
        .filter((b) => b.name.startsWith(folder) && !b.name.slice(folder.length).includes("/"))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    : [];
  const changed = combine(commits);
  const label: Record<View, string> = {
    changes: changed.length ? `Changes ${changed.length}` : "Changes",
    history: commits.length ? `History ${commits.length}` : "History",
    files: "Files",
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-6 px-8 pt-10 pb-16 max-sm:px-4 max-sm:pt-6">
        <header className="flex flex-wrap items-center gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-tint text-signal">
            <GitBranch className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[26px] leading-8 font-medium tracking-[-0.03em]">
              {branch}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              {info.forkedFrom ? (
                <>
                  Forked from
                  <Link
                    href={branchPath(ns, info.forkedFrom)}
                    className="text-foreground underline-offset-4 hover:underline"
                  >
                    {info.forkedFrom}
                  </Link>
                  <Ago time={info.created} className="text-sm" />
                </>
              ) : (
                <>
                  {info.protected ? "Protected" : "Branch"} · updated
                  <Ago time={info.updated} className="text-sm" />
                </>
              )}
              {review?.state === "merged" && (
                <span className="flex items-center gap-1 text-green">
                  · <GitMerge className="size-3.5" /> Merged into {review.into}
                </span>
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
                  <MenuLabel className="text-xs font-normal text-muted-foreground">
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
            <Button asChild leadingIcon={FolderOpen}>
              <Link href={`${nsPath(ns)}?branch=${encodeURIComponent(branch)}`}>Open files</Link>
            </Button>
            <Button leadingIcon={GitFork} onClick={() => openFork(branch)}>
              Fork
            </Button>
          </div>
        </header>

        {review?.state === "open" && <ReviewBar review={review} check={check} />}

        <TabNav
          id={`branch-${branch}`}
          tabs={views.map((name) => ({
            href: `${pathname}?tab=${name}`,
            label: label[name],
            active: view === name,
          }))}
        />

        {view === "changes" && review && info.head && (
          <section className="panel p-2">
            <Changes
              ns={ns}
              branch={branch}
              changes={changed}
              at={info.head}
              parent={forkPoint}
              open={path}
              onOpen={(next) => show({ path: next || null })}
            />
          </section>
        )}

        {view === "history" &&
          (commits.length ? (
            <CommitList
              ns={ns}
              branch={branch}
              commits={commits}
              open={params.get("commit")}
              path={path}
              onOpen={(hash) => show({ commit: hash, path: null })}
              onPath={(next) => show({ path: next || null })}
              onFork={(hash) => openFork(branch, hash)}
            />
          ) : (
            <Note>Nothing written to this branch yet.</Note>
          ))}

        {view === "files" && (
          <section className="grid gap-3">
            {at && at !== info.head && (
              <div className="flex min-h-12 flex-wrap items-center gap-3 rounded-2xl bg-tint px-4 py-2 text-sm">
                <History className="size-4 text-signal" />
                <span>
                  As of <Hash value={at} className="text-foreground" />
                </span>
                <span className="ml-auto flex gap-2">
                  <Button onClick={() => show({ at: null, path: null })}>Latest</Button>
                  <Button
                    variant="primary"
                    leadingIcon={GitFork}
                    onClick={() => openFork(branch, at)}
                  >
                    Fork from here
                  </Button>
                </span>
              </div>
            )}
            <div className="panel p-3">
              <FileBrowser
                ns={ns}
                branch={branch}
                at={at ?? info.head ?? ""}
                path={path}
                onOpen={(next) => show({ path: next || null })}
              />
            </div>
          </section>
        )}
      </div>
      {fork && <ForkDialog ns={ns} from={fork.from} at={fork.at} open onOpenChange={closeFork} />}
    </div>
  );
}

/** Merge brings the branch into the one it was forked from; reject deletes it. */
function ReviewBar({ review, check }: { review: Review; check: Check }) {
  const zero = useZero();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const { ns } = review;
  const name = review.branch.name;
  const conflicts = check?.conflicts ?? [];

  async function merge() {
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
    <div
      className={cn(
        "flex min-h-16 flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl px-5 py-3",
        conflicts.length ? "bg-destructive/[0.07]" : "bg-tint",
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full bg-background",
          conflicts.length ? "text-destructive" : "text-signal",
        )}
      >
        {conflicts.length ? <X className="size-4" /> : <GitMerge className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {!check
            ? "Checking the merge…"
            : conflicts.length
              ? `Conflicts with ${review.into}`
              : `Ready to merge into ${review.into}`}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {conflicts.length
            ? `In ${conflicts.join(", ")}. Fork a new try from ${review.into}.`
            : `${plural(review.commits.length, "commit")} · ${plural(filesOf(review.commits), "file")} changed`}
        </span>
      </span>
      <span className="flex gap-2">
        <Button variant="plain" disabled={busy} onClick={() => setRejecting(true)}>
          Reject
        </Button>
        <Button
          leadingIcon={GitMerge}
          variant="primary"
          disabled={busy || !check || conflicts.length > 0}
          onClick={merge}
        >
          Merge
        </Button>
      </span>
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
    </div>
  );
}
