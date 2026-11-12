"use client";

import { useQuery } from "@rocicorp/zero/react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useNow } from "@/components/kit";
import { useRole } from "@/components/shell/role";
import { seesAudit } from "@/zero/roles";
import { queries } from "@/zero/queries";
import type { Branch, Claim, Commit, Session } from "@/zero/schema";
import { changesOf, type Event, eventOf } from "./events";
import { envOf } from "@/lib/names";
import { apiPath } from "@/lib/paths";

// Everything the console derives from Zero's rows for one environment or one
// filesystem: reviews, agents, and what went wrong. Pages ask for a scope and
// read what they need.

export type Scope = { env: string } | { ns: string };

export type Review = {
  ns: string;
  branch: Branch;
  /** The protected branch it was forked from, and would merge into. */
  into: string;
  /** Its own commits, newest first. */
  commits: Commit[];
  state: "open" | "merged";
  agent: string | undefined;
};

export type Agent = Session & {
  claims: readonly Claim[];
  live: boolean;
  /** The branch it works on: the one it holds, or the one it last committed to. */
  branch: string | undefined;
  last: Commit | undefined;
  /** It committed, ended, and none of its work was merged. */
  stranded: boolean;
};

export type Rejection = { ns: string; branch: string; at: number; actor: string };

const inScope = (scope: Scope) => (ns: string) =>
  "ns" in scope ? ns === scope.ns : envOf(ns) === scope.env;

const key = (ns: string, branch: string) => `${ns}\n${branch}`;

export function useFleet(scope: Scope) {
  const [namespaces, nsResult] = useQuery(queries.namespaces());
  const [allBranches, branchResult] = useQuery(queries.orgBranches());
  const [allCommits] = useQuery(queries.orgCommits({ limit: 10_000 }));
  const [allSessions] = useQuery(queries.orgSessions());
  const [audit] = useQuery(queries.activity({ limit: 1000 }));
  const admin = seesAudit(useRole());
  const current = useNow();
  const scopeKey = "ns" in scope ? `ns:${scope.ns}` : `env:${scope.env}`;

  const data = useMemo(() => {
    const keep = inScope(scope);
    const branches = allBranches.filter((b) => keep(b.namespace));
    const commits = allCommits.filter((c) => keep(c.namespace));
    const sessions = allSessions.filter((s) => keep(s.namespace));
    const events = admin
      ? audit.map(eventOf).filter((e): e is Event => !!e && keep(e.ns))
      : changesOf(
          commits,
          branches,
          namespaces.filter((n) => keep(n.name)),
        );

    const labels = new Map(sessions.map((s) => [s.id, s.label]));
    const agentOf = (commit?: Commit) =>
      commit
        ? (commit.agent ?? (commit.session ? labels.get(commit.session) : undefined))
        : undefined;

    const byBranch = new Map<string, Commit[]>();
    for (const commit of commits) {
      const k = key(commit.namespace, commit.branch);
      byBranch.set(k, [...(byBranch.get(k) ?? []), commit]);
    }

    // A review is a fork of a protected branch that has commits of its own.
    // It is merged once the protected branch has a merge of its current head.
    const protectedNames = new Set(
      branches.filter((b) => b.protected).map((b) => key(b.namespace, b.name)),
    );
    const mergedHeads = new Set(commits.map((c) => c.merged).filter(Boolean));
    const reviews: Review[] = [];
    for (const branch of branches) {
      if (!branch.forkedFrom || !protectedNames.has(key(branch.namespace, branch.forkedFrom)))
        continue;
      const own = byBranch.get(key(branch.namespace, branch.name)) ?? [];
      if (!own.length) continue;
      reviews.push({
        ns: branch.namespace,
        branch,
        into: branch.forkedFrom,
        commits: own,
        state: mergedHeads.has(branch.head ?? "") ? "merged" : "open",
        agent: agentOf(own.find((c) => !c.merged) ?? own[0]),
      });
    }
    reviews.sort((a, b) => b.branch.updated - a.branch.updated);
    const merged = new Set(
      reviews.filter((r) => r.state === "merged").map((r) => key(r.ns, r.branch.name)),
    );

    const lastBySession = new Map<string, Commit>();
    for (const commit of commits) {
      if (commit.session && !lastBySession.has(commit.session))
        lastBySession.set(commit.session, commit);
    }
    const agents: Agent[] = sessions
      .map((session) => {
        const last = lastBySession.get(session.id);
        const live = session.expires > current;
        const landed =
          !!last &&
          commits.some(
            (c) => c.session === session.id && (c.merged || merged.has(key(c.namespace, c.branch))),
          );
        return {
          ...session,
          live,
          branch: session.claims[0]?.branch ?? last?.branch,
          last,
          stranded: !live && !!last && !landed,
        };
      })
      .sort((a, b) => (b.last?.at ?? b.created) - (a.last?.at ?? a.created));

    // A branch deleted without being merged was rejected, unless another try
    // of the same task (a branch in the same folder) was merged after all.
    const folder = (name: string) => name.slice(0, name.lastIndexOf("/") + 1);
    const mergedFrom = new Set<string>();
    const mergedFolders = new Set<string>();
    for (const { ns, from = "" } of events.filter((e) => e.kind === "merge")) {
      mergedFrom.add(key(ns, from));
      if (folder(from)) mergedFolders.add(key(ns, folder(from)));
    }
    const rejections: Rejection[] = events
      .filter((e) => e.kind === "delete")
      .map(({ ns, branch, at, actor }) => ({ ns, branch, at, actor }))
      .filter(
        (r) =>
          !mergedFrom.has(key(r.ns, r.branch)) &&
          !(folder(r.branch) && mergedFolders.has(key(r.ns, folder(r.branch)))),
      );

    return {
      namespaces: namespaces.filter((n) => keep(n.name)),
      branches,
      commits,
      sessions,
      events,
      reviews,
      agents,
      rejections,
      agentOf,
      commitsOf: (ns: string, branch: string) => byBranch.get(key(ns, branch)) ?? [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, namespaces, allBranches, allCommits, allSessions, audit, admin, current]);

  return {
    ...data,
    loading: nsResult.type !== "complete" || branchResult.type !== "complete",
  };
}

// Merge checks ask skywake-api for a dry run. Answers are kept per pair of
// heads, so every page that shows a review shares one request.

export type Check = { conflicts: string[] } | undefined;

const checks = new Map<string, Check | "pending">();
const watchers = new Set<() => void>();
let version = 0;

function request(review: Review, target: string | null | undefined) {
  const id = [review.ns, review.into, review.branch.name, review.branch.head, target].join("\n");
  if (checks.has(id)) return id;
  checks.set(id, "pending");
  fetch(apiPath(review.ns, "merges"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ into: review.into, from: review.branch.name, dry_run: true }),
  })
    .then((response) => (response.ok ? response.json() : { conflicts: [] }))
    .catch(() => ({ conflicts: [] }))
    .then((value: { conflicts: string[] }) => {
      checks.set(id, value);
      version++;
      watchers.forEach((watch) => watch());
    });
  return id;
}

const subscribe = (watch: () => void) => {
  watchers.add(watch);
  return () => void watchers.delete(watch);
};

/** The merge check of each open review, by branch name, once skywake-api answers. */
export function useChecks(reviews: Review[], branches: Branch[]) {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  const open = reviews.filter((r) => r.state === "open");
  const heads = new Map(branches.map((b) => [key(b.namespace, b.name), b.head]));
  const ids = open.map((review) => [
    key(review.ns, review.branch.name),
    [
      review.ns,
      review.into,
      review.branch.name,
      review.branch.head,
      heads.get(key(review.ns, review.into)),
    ].join("\n"),
  ]);
  const signature = ids.map(([, id]) => id).join("\t");

  useEffect(() => {
    for (const review of open) request(review, heads.get(key(review.ns, review.into)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const result = new Map<string, Check>();
  for (const [branch, id] of ids) {
    const value = checks.get(id);
    result.set(branch, value === "pending" ? undefined : value);
  }
  return {
    get: (review: Review) => result.get(key(review.ns, review.branch.name)),
  };
}

export const reviewKey = (review: Review) => key(review.ns, review.branch.name);

export function filesOf(commits: readonly Commit[]) {
  return new Set(commits.flatMap((c) => c.changes.map((change) => change.path))).size;
}

/**
 * The branch a filesystem opens on: a protected one, else `main`, else one
 * that was not forked. Forks such as `agents/1` sort before `main`, so the
 * first in the list is not enough.
 */
export function mainOf(branches: readonly Branch[]) {
  return (
    branches.find((b) => b.protected) ??
    branches.find((b) => b.name === "main") ??
    branches.find((b) => !b.forkedFrom) ??
    branches[0]
  );
}
