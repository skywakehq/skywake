"use client";

import { useState } from "react";
import { mainOf, useFleet } from "@/features/fleet/fleet";
import { ForkDialog, useForkDialog } from "@/features/branches/branch-actions";
import { CommitList } from "@/features/branches/commit-list";
import { NamespacePage } from "./namespace-header";
import { Empty, Rows } from "@/components/kit";

/** The main branch's history, commit by commit. Each opens to its changes, and can be browsed or forked. */
export function History({ ns }: { ns: string }) {
  const fleet = useFleet({ ns });
  const { fork, openFork, closeFork } = useForkDialog();
  const [open, setOpen] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const main = mainOf(fleet.branches);
  const commits = main ? fleet.commitsOf(ns, main.name) : [];

  return (
    <NamespacePage ns={ns} main={main?.name} head={main?.head} commits={fleet.commits.length}>
      {fleet.loading && !commits.length && <Rows count={10} />}
      {main && commits.length > 0 && (
        <CommitList
          ns={ns}
          branch={main.name}
          commits={commits}
          open={open}
          path={path}
          onOpen={(hash) => {
            setOpen(hash);
            setPath("");
          }}
          onPath={setPath}
          onFork={(hash) => openFork(main.name, hash)}
        />
      )}
      {!fleet.loading && !commits.length && (
        <Empty title={`Nothing in ${main?.name ?? "main"} yet`}>
          Every change to it shows here.
        </Empty>
      )}
      {fork && <ForkDialog ns={ns} from={fork.from} at={fork.at} open onOpenChange={closeFork} />}
    </NamespacePage>
  );
}
