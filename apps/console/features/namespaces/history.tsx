"use client";

import { FolderOpen, GitFork, GitMerge } from "lucide-react";
import { Fragment } from "react";
import { Link } from "@/components/shell/router";
import { mainOf, useFleet } from "@/features/fleet/fleet";
import { branchPath } from "@/lib/paths";
import { usePeople } from "@/hooks/use-people";
import { ForkDialog, useForkDialog } from "@/features/branches/branch-actions";
import { NamespacePage } from "./namespace-header";
import { Ago, Avatar, Button, cx, Empty, Glide, Hash, Panel, Rows } from "@/components/kit";

function day(time: number) {
  const date = new Date(time);
  if (date.toDateString() === new Date().toDateString()) return "Today";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/**
 * The main branch's timeline. Every merge names the agent it came from, and
 * every commit can be opened or forked: time travel at the level a lead
 * thinks about it.
 */
export function History({ ns }: { ns: string }) {
  const fleet = useFleet({ ns });
  const people = usePeople();
  const { fork, openFork, closeFork } = useForkDialog();
  const main = mainOf(fleet.branches);
  const commits = main ? fleet.commitsOf(ns, main.name) : [];

  return (
    <NamespacePage
      ns={ns}
      main={main?.name}
      head={main?.head}
      commits={fleet.commits.length}
      onFork={main ? () => openFork(main.name) : undefined}
    >
      <Panel title={main ? `${main.name}, newest first` : "History"} count={commits.length}>
        {fleet.loading && !commits.length && <Rows count={10} />}
        <Glide>
          <ol>
            {commits.map((commit, i) => {
              const heading = day(commit.at);
              const showDay = i === 0 || day(commits[i - 1]!.at) !== heading;
              const who = fleet.agentOf(commit) ?? people(commit.actor);
              return (
                <Fragment key={commit.hash}>
                  {showDay && (
                    <li className="sticky top-0 z-20 border-b bg-background/95 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur">
                      {heading}
                    </li>
                  )}
                  <li data-glide className="group relative flex min-h-14 items-center gap-3 px-4">
                    <span
                      aria-hidden
                      className="absolute bottom-0 left-[29px] w-px bg-border"
                      style={{ top: i === 0 ? "50%" : 0 }}
                    />
                    <span
                      className={cx(
                        "relative z-10 grid size-7 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground",
                        commit.merged && "border-green/40 bg-green/10 text-green",
                      )}
                    >
                      {commit.merged ? (
                        <GitMerge className="size-3.5" />
                      ) : (
                        <span className="size-1.5 rounded-full bg-foreground" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 py-2">
                      <p className="truncate text-sm font-medium">
                        {commit.message || "No message"}
                      </p>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <Avatar name={who} className="size-4 text-[8px] ring-0" />
                        <span className="truncate">{who}</span>
                        <Hash value={commit.hash} className="text-faint" />
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 max-sm:hidden">
                      <Button asChild size="sm" leadingIcon={FolderOpen}>
                        <Link href={branchPath(ns, main.name, { at: commit.hash, tab: "files" })}>
                          Browse
                        </Link>
                      </Button>
                      <Button
                        leadingIcon={GitFork}
                        size="sm"
                        onClick={() => openFork(main.name, commit.hash)}
                      >
                        Fork from here
                      </Button>
                    </span>
                    <Ago time={commit.at} className="w-8 text-right" />
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </Glide>
        {!fleet.loading && !commits.length && (
          <Empty
            title={`No merges into ${main?.name ?? "main"} yet`}
            columns={["Merge", "Agent", "When"]}
          >
            Each merge shows here with the agent it came from.
          </Empty>
        )}
      </Panel>
      {fork && <ForkDialog ns={ns} from={fork.from} at={fork.at} open onOpenChange={closeFork} />}
    </NamespacePage>
  );
}
