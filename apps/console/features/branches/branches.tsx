"use client";

import {
  ChevronRight,
  GitFork,
  Lock,
  LockOpen,
  MoreHorizontal,
  Search,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "@/components/shell/router";
import { useMemo, useState } from "react";
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
import { type Agent, type Check, type Review, useChecks, useFleet } from "@/features/fleet/fleet";
import { branchPath } from "@/lib/paths";
import { cn } from "@skywake/ui/lib/utils";
import type { Branch } from "@/zero/schema";
import { ForkDialog, useBranchActions, useForkDialog } from "./branch-actions";
import { NamespacePage } from "@/features/namespaces/namespace-header";
import {
  Ago,
  Avatar,
  Button,
  Empty,
  Hash,
  Panel,
  perDay,
  plural,
  Rows,
  Stat,
  Stats,
  useNow,
  Glide,
  Choice,
} from "@/components/kit";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/menu";
import { type Status, StatusPill } from "@/components/status";

type Leaf = {
  kind: "leaf";
  name: string;
  label: string;
  branch: Branch;
  status: Status;
  agent?: string;
  commits: number;
};
type Group = { kind: "group"; name: string; label: string; children: Node[] };
type Node = Leaf | Group;

// Which state a folded group shows: the one that most needs a person.
const URGENCY: Status[] = ["conflict", "live", "ready", "checking", "idle", "merged", "protected"];

export function branchStatus(
  branch: Branch,
  review: Review | undefined,
  check: Check,
  agent: Agent | undefined,
): Status {
  if (branch.protected) return "protected";
  if (review?.state === "merged") return "merged";
  if (agent?.live) return "live";
  if (review) return check ? (check.conflicts.length ? "conflict" : "ready") : "checking";
  return "idle";
}

/** Groups branch names by their `/` parts, like folders, and folds single-child chains. */
function group(leaves: Leaf[]): Node[] {
  const root: Group = { kind: "group", name: "", label: "", children: [] };
  for (const leaf of leaves) {
    const parts = leaf.name.split("/");
    let node = root;
    parts.slice(0, -1).forEach((part, i) => {
      const name = parts.slice(0, i + 1).join("/");
      let next = node.children.find((c): c is Group => c.kind === "group" && c.name === name);
      if (!next) {
        next = { kind: "group", name, label: part, children: [] };
        node.children.push(next);
      }
      node = next;
    });
    node.children.push({ ...leaf, label: parts.at(-1)! });
  }
  const fold = (node: Node): Node => {
    if (node.kind === "leaf") return node;
    const children = node.children.map(fold).sort(order);
    if (children.length === 1 && node.name) {
      const only = children[0];
      return { ...only, label: `${node.label}/${only.label}` };
    }
    return { ...node, children };
  };
  return (fold(root) as Group).children;
}

const order = (a: Node, b: Node) => a.label.localeCompare(b.label, undefined, { numeric: true });

const leavesOf = (node: Node): Leaf[] =>
  node.kind === "leaf" ? [node] : node.children.flatMap(leavesOf);

/** A filesystem's open work, as a tree of branches grouped by name. */
export function Branches({ ns }: { ns: string }) {
  const fleet = useFleet({ ns });
  const checks = useChecks(fleet.reviews, fleet.branches);
  const [show, setShow] = useState<"open" | "all">("open");
  const [filter, setFilter] = useState("");
  const { fork, openFork, closeFork } = useForkDialog();
  const actions = useBranchActions(ns);
  const current = useNow();

  const leaves = useMemo(() => {
    const reviews = new Map(fleet.reviews.map((r) => [r.branch.name, r]));
    const agents = new Map<string, Agent>();
    for (const agent of fleet.agents) {
      if (agent.branch && (agent.live || !agents.has(agent.branch)))
        agents.set(agent.branch, agent);
    }
    return fleet.branches.map((branch): Leaf => {
      const review = reviews.get(branch.name);
      const agent = agents.get(branch.name);
      const commits = fleet.commitsOf(ns, branch.name);
      return {
        kind: "leaf",
        name: branch.name,
        label: branch.name,
        branch,
        status: branchStatus(branch, review, review && checks.get(review), agent),
        agent: agent?.label ?? review?.agent ?? fleet.agentOf(commits[0]),
        commits: commits.length,
      };
    });
  }, [fleet, checks, ns]);

  const roots = leaves.filter((l) => l.branch.protected);
  const main = roots[0]?.branch ?? fleet.branches[0];
  const merged = leaves.filter((l) => l.status === "merged").length;
  const rest = leaves.filter(
    (l) =>
      !l.branch.protected &&
      (show === "all" || l.status !== "merged") &&
      (!filter || l.name.includes(filter)),
  );
  const tree = group(rest);

  const live = leaves.filter((l) => l.status === "live").length;
  const waiting = leaves.filter((l) => l.status === "ready" || l.status === "conflict").length;
  const activity = perDay(
    fleet.commits.map((c) => c.at),
    14,
    current,
  );

  return (
    <NamespacePage
      ns={ns}
      main={main?.name}
      head={main?.head}
      commits={fleet.commits.length}
      onFork={main ? () => openFork(main.name) : undefined}
      tools={
        <>
          <label className="flex h-7 w-44 items-center gap-1.5 rounded-md bg-muted/70 px-2 text-muted-foreground max-sm:hidden">
            <Search className="size-3.5 shrink-0" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter branches"
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <Choice
            value={show}
            onChange={setShow}
            options={[
              { value: "open", label: "Open" },
              { value: "all", label: "All" },
            ]}
          />
        </>
      }
    >
      {fleet.branches.length > 0 && (
        <Stats>
          <Stat label="Open branches" value={rest.filter((l) => l.status !== "merged").length} />
          <Stat label="Live sessions" value={live} note="working on a branch" />
          <Stat label="To merge" value={waiting} note={`${merged} merged so far`} alert />
          <Stat
            label="Commits"
            value={activity.reduce((a, b) => a + b, 0)}
            note="last 14 days"
            trend={activity}
          />
        </Stats>
      )}

      {fleet.loading && !leaves.length ? (
        <Rows />
      ) : fleet.branches.length ? (
        <Panel
          title="Branches"
          count={rest.length + roots.length}
          action={
            <span className="text-xs text-muted-foreground">
              {merged} merged · {fleet.rejections.length} rejected
              {show === "open" && merged > 0 && (
                <button
                  onClick={() => setShow("all")}
                  className="ml-2 text-foreground underline-offset-4 hover:underline"
                >
                  Show merged
                </button>
              )}
            </span>
          }
        >
          <Glide className="py-1">
            {roots.map((leaf) => (
              <LeafRow key={leaf.name} ns={ns} leaf={leaf} depth={0} onFork={openFork} />
            ))}
            {tree.map((node) => (
              <TreeNode
                key={node.name}
                ns={ns}
                node={node}
                depth={roots.length ? 1 : 0}
                onFork={openFork}
              />
            ))}
          </Glide>
        </Panel>
      ) : (
        <div className="-mx-5">
          <Empty title="Start with main" columns={["Branch", "Commits", "Updated"]}>
            <p>Create an empty main branch. Agents fork from it and merge back into it.</p>
            <Button variant="primary" className="mt-4" onClick={() => actions.create("main")}>
              Create main
            </Button>
          </Empty>
        </div>
      )}
      {fork && <ForkDialog ns={ns} from={fork.from} at={fork.at} open onOpenChange={closeFork} />}
    </NamespacePage>
  );
}

type RowProps = { ns: string; depth: number; onFork: (from: string) => void };

function TreeNode({ node, ...props }: RowProps & { node: Node }) {
  return node.kind === "leaf" ? (
    <LeafRow leaf={node} {...props} />
  ) : (
    <GroupRow group={node} {...props} />
  );
}

const indent = (depth: number) => ({ paddingLeft: 16 + depth * 18 });

function GroupRow({ group, depth, ...props }: RowProps & { group: Group }) {
  const leaves = leavesOf(group);
  // A folder of folders starts open; a folder of tries starts folded into one row.
  const [open, setOpen] = useState(group.children.some((c) => c.kind === "group"));
  const status = URGENCY.find((s) => leaves.some((l) => l.status === s)) ?? "idle";
  const latest = Math.max(...leaves.map((l) => l.branch.updated));
  const agent = leaves.find((l) => l.agent)?.agent;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        data-glide
        className="flex h-11 w-full items-center gap-2 pr-4 text-left"
        style={indent(depth)}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        <span className="truncate font-mono text-sm">{group.label}/</span>
        <span className="shrink-0 text-xs text-faint">{plural(leaves.length, "branch")}</span>
        <span className="ml-auto flex shrink-0 items-center gap-4">
          <AnimatePresence initial={false}>
            {!open && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-4"
              >
                <span className="hidden w-28 truncate text-right text-xs text-muted-foreground sm:block">
                  {agent}
                </span>
                <StatusPill status={status} className="w-[84px] justify-center" />
              </motion.span>
            )}
          </AnimatePresence>
          <Ago time={latest} className="w-8 text-right" />
          <span className="w-6" />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden"
          >
            <span
              aria-hidden
              className="absolute top-0 bottom-2 w-px bg-border"
              style={{ left: 23 + depth * 18 }}
            />
            {group.children.map((child) => (
              <TreeNode key={child.name} node={child} depth={depth + 1} {...props} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LeafRow({ ns, leaf, depth, onFork }: RowProps & { leaf: Leaf }) {
  const actions = useBranchActions(ns);
  const [confirming, setConfirming] = useState(false);
  const { branch } = leaf;
  return (
    <div data-glide className="group relative flex h-11 items-center gap-2 pr-4">
      <Link
        href={branchPath(ns, branch.name)}
        className="absolute inset-0"
        aria-label={branch.name}
      />
      <span className="flex min-w-0 items-center gap-2" style={indent(depth)}>
        <span className="w-3.5 shrink-0" />
        <span className={cn("truncate font-mono text-sm", branch.protected && "font-medium")}>
          {leaf.label}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-4">
        <span className="hidden w-32 items-center justify-end gap-1.5 truncate text-xs text-muted-foreground sm:flex">
          {leaf.agent && (
            <>
              <Avatar name={leaf.agent} className="size-4 text-[8px] ring-0" />
              <span className="truncate">{leaf.agent}</span>
            </>
          )}
        </span>
        <span className="hidden w-20 text-right text-xs tabular-nums text-muted-foreground md:block">
          {leaf.commits ? plural(leaf.commits, "commit") : ""}
        </span>
        <Hash value={branch.head} className="hidden w-16 text-faint lg:block" />
        <StatusPill status={leaf.status} className="w-[84px] justify-center" />
        <Ago time={branch.updated} className="w-8 text-right" />
        <Menu>
          <MenuTrigger className="relative grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 outline-none transition-opacity group-hover:opacity-100 hover:bg-selected focus-visible:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal className="size-4" />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem index={0} icon={GitFork} label="Fork…" onSelect={() => onFork(branch.name)} />
            <MenuItem
              index={1}
              icon={branch.protected ? LockOpen : Lock}
              label={branch.protected ? "Unprotect" : "Protect"}
              onSelect={() => actions.protect(branch.name, !branch.protected)}
            />
            <MenuSeparator />
            <MenuItem index={2} icon={Trash2} label="Delete" onSelect={() => setConfirming(true)} />
          </MenuContent>
        </Menu>
      </span>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="sm:max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Delete {branch.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The branch and its commits leave the list. Work merged from it stays where it was
              merged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => actions.remove(branch.name)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
