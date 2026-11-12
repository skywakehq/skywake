import type { Audit, Branch, Commit } from "@/zero/schema";

/** The audit actions the console shows: the writes that change a namespace. */
export const SHOWN = [
  "commitFiles",
  "mergeBranches",
  "createBranch",
  "deleteBranch",
  "updateBranch",
  "createNamespace",
];

export type Event = {
  id: number;
  at: number;
  actor: string;
  kind: "commit" | "merge" | "fork" | "delete" | "protect" | "unprotect" | "create";
  ns: string;
  branch: string;
  // For a merge, the branch merged in.
  from?: string;
  // For a commit, the new head.
  head?: string;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Reads an audit row as an event, or undefined for actions the console doesn't show. */
export function eventOf(row: Audit): Event | undefined {
  const { namespace = "", branch = "" } = row.resource;
  const details = row.details ?? {};
  const base = { id: row.id, at: row.at, actor: row.actor ?? "", ns: namespace, branch };
  switch (row.action) {
    case "commitFiles":
      return { ...base, kind: "commit", head: text(details.head) };
    case "mergeBranches":
      return { ...base, kind: "merge", branch: text(details.into), from: text(details.from) };
    case "createBranch":
      return { ...base, kind: "fork", branch: text(details.branch) };
    case "deleteBranch":
      return { ...base, kind: "delete" };
    case "updateBranch":
      return { ...base, kind: details.protected ? "protect" : "unprotect" };
    case "createNamespace":
      return { ...base, kind: "create", ns: text(details.namespace) };
  }
}

type Made = { name: string; created: number };

/**
 * What changed, read from commits, branches and filesystems. Members see this
 * instead of the audit log: commits, merges, forks and new filesystems.
 */
export function changesOf(
  commits: readonly Commit[],
  branches: readonly Branch[],
  namespaces: readonly Made[],
): Event[] {
  const branchOf = new Map(commits.map((c) => [`${c.namespace}\n${c.hash}`, c.branch]));
  const events: Omit<Event, "id">[] = [
    ...commits.map((c) => {
      const base = { at: c.at, actor: c.actor, ns: c.namespace, branch: c.branch, head: c.hash };
      if (!c.merged) return { ...base, kind: "commit" as const };
      const from = branchOf.get(`${c.namespace}\n${c.merged}`) ?? "";
      return { ...base, kind: "merge" as const, from };
    }),
    ...branches
      .filter((b) => b.forkedFrom)
      .map((b) => ({
        kind: "fork" as const,
        at: b.created,
        actor: "",
        ns: b.namespace,
        branch: b.name,
      })),
    ...namespaces.map((n) => ({
      kind: "create" as const,
      at: n.created,
      actor: "",
      ns: n.name,
      branch: "",
    })),
  ];
  // Negative ids never meet an audit row's.
  return events.sort((a, b) => b.at - a.at).map((event, i) => ({ ...event, id: -(i + 1) }));
}
