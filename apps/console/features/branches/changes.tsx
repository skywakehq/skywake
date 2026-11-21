"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@skywake/ui/lib/utils";
import type { Change, Commit } from "@/zero/schema";
import { FileIcon } from "@/features/files/file-icon";
import { FileDiff, Note } from "./diff";

const ease = [0.22, 1, 0.36, 1] as const;

const KIND = {
  added: { label: "Added", className: "text-green" },
  removed: { label: "Deleted", className: "text-destructive" },
  modified: { label: "Changed", className: "text-muted-foreground" },
} as const;

/** What a run of commits did in all: a file added then changed is still added. */
export function combine(commits: readonly Commit[]): Change[] {
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

/** Changed files, one row each; opening one shows its diff under it. */
export function Changes({
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
  changes: readonly Change[];
  at: string;
  parent?: string | null;
  open: string;
  onOpen: (path: string) => void;
}) {
  if (!changes.length) return <Note>No files changed.</Note>;
  return (
    <ul className="grid gap-0.5">
      {changes.map((change) => {
        const expanded = open === change.path;
        const kind = KIND[change.kind];
        return (
          <li key={change.path}>
            <button
              onClick={() => onOpen(expanded ? "" : change.path)}
              aria-expanded={expanded}
              className={cn(
                "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors",
                expanded ? "bg-active" : "hover:bg-hover",
              )}
            >
              <FileIcon name={change.path} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm">{change.path}</span>
              <span className={cn("shrink-0 text-xs", kind.className)}>{kind.label}</span>
            </button>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease }}
                  className="overflow-hidden"
                >
                  <div className="my-1 overflow-hidden rounded-xl bg-background py-2">
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
        );
      })}
    </ul>
  );
}
