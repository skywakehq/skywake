"use client";

import { ChevronRight, FolderOpen, GitFork, GitMerge } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment } from "react";
import { Link } from "@/components/shell/router";
import { Ago, Avatar, Button, Hash, plural } from "@/components/kit";
import { usePeople } from "@/hooks/use-people";
import { branchPath } from "@/lib/paths";
import { cn } from "@skywake/ui/lib/utils";
import type { Commit } from "@/zero/schema";
import { Changes } from "./changes";

const ease = [0.22, 1, 0.36, 1] as const;

function day(time: number) {
  const date = new Date(time);
  if (date.toDateString() === new Date().toDateString()) return "Today";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/** A branch's commits by day. Opening one shows the files it changed, each with its diff. */
export function CommitList({
  ns,
  branch,
  commits,
  open,
  path,
  onOpen,
  onPath,
  onFork,
}: {
  ns: string;
  branch: string;
  commits: readonly Commit[];
  open: string | null;
  path: string;
  onOpen: (hash: string | null) => void;
  onPath: (path: string) => void;
  onFork: (hash: string) => void;
}) {
  const people = usePeople();
  return (
    <ol className="grid gap-1">
      {commits.map((commit, i) => {
        const heading = day(commit.at);
        const first = i === 0 || day(commits[i - 1]!.at) !== heading;
        const expanded = open === commit.hash;
        const who = people(commit.actor);
        return (
          <Fragment key={commit.hash}>
            {first && (
              <li className="px-4 pt-6 pb-2 text-xs font-medium text-muted-foreground first:pt-0">
                {heading}
              </li>
            )}
            <li className={cn("rounded-2xl transition-colors", expanded && "bg-(--panel)")}>
              <div className="group flex min-h-14 items-center gap-3 rounded-2xl pr-3 hover:bg-hover">
                <button
                  onClick={() => onOpen(expanded ? null : commit.hash)}
                  aria-expanded={expanded}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left"
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                      expanded && "rotate-90",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      {commit.merged && <GitMerge className="size-3.5 shrink-0 text-green" />}
                      <span className="truncate text-sm font-medium">
                        {commit.message || "No message"}
                      </span>
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Avatar name={who} className="size-4" />
                      <span className="truncate">{who}</span>
                      <span className="text-faint">·</span>
                      <span className="shrink-0">{plural(commit.changes.length, "file")}</span>
                    </span>
                  </span>
                </button>
                <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 max-sm:hidden">
                  <Button asChild size="sm" leadingIcon={FolderOpen}>
                    <Link href={branchPath(ns, branch, { at: commit.hash, tab: "files" })}>
                      Browse
                    </Link>
                  </Button>
                  <Button size="sm" leadingIcon={GitFork} onClick={() => onFork(commit.hash)}>
                    Fork from here
                  </Button>
                </span>
                <Hash value={commit.hash} className="w-16 shrink-0 text-faint max-md:hidden" />
                <Ago time={commit.at} className="w-8 shrink-0 text-right" />
              </div>
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pt-1 pb-3">
                      <Changes
                        ns={ns}
                        branch={branch}
                        changes={commit.changes}
                        at={commit.hash}
                        parent={commit.parent}
                        open={path}
                        onOpen={onPath}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
