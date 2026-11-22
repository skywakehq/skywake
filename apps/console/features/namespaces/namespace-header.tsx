"use client";

import { useQuery } from "@rocicorp/zero/react";
import { GitFork, Plug } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useRoute } from "@/components/shell/router";
import { nameInEnv } from "@/lib/names";
import { nsPath } from "@/lib/paths";
import { Button, DiskMark, Hash, TabNav, plural } from "@/components/kit";
import { ConnectAgent, connectAgent, useConnectAgent } from "@/features/agents/connect-agent";
import { ForkDialog, useForkDialog } from "@/features/branches/branch-actions";
import { useFleet } from "@/features/fleet/fleet";
import { queries } from "@/zero/queries";
import { DeleteNamespace } from "./delete-namespace";
import { BucketBadge, MountLine, useSearchOn } from "./disk-facts";

const TABS = [
  ["files", "Files"],
  ["branches", "Branches"],
  ["history", "History"],
  ["search", "Search"],
] as const;

/** A disk's page: its folder and name, four views, the open view, and the disk's details beside it. */
export function NamespacePage({
  ns,
  main,
  head,
  commits,
  tools,
  children,
}: {
  ns: string;
  main?: string;
  head?: string | null;
  commits: number;
  tools?: ReactNode;
  children: ReactNode;
}) {
  const { view } = useRoute();
  const { fork, openFork, closeFork } = useForkDialog();
  const [connecting, setConnecting] = useConnectAgent(ns);
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="grid gap-6 px-8 pt-8 pb-16 max-sm:px-4 max-sm:pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <DiskMark className="h-8" />
          <h1 className="min-w-0 truncate text-[22px] leading-8 font-medium tracking-[-0.025em]">
            {nameInEnv(ns)}
          </h1>
          <div className="ml-auto flex gap-2">
            <Button
              size="default"
              variant="primary"
              leadingIcon={Plug}
              onClick={() => connectAgent(ns)}
            >
              Connect an agent
            </Button>
            {main && (
              <Button size="default" onClick={() => openFork(main)} leadingIcon={GitFork}>
                Fork {main}
              </Button>
            )}
            <DeleteNamespace ns={ns} />
          </div>
        </div>
        <TabNav
          id={ns}
          tabs={TABS.map(([page, label]) => ({
            href: nsPath(ns, page),
            label,
            active: view === page,
          }))}
          tools={tools}
        />
        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="grid min-w-0 gap-8">{children}</div>
          <Details ns={ns} main={main} head={head} commits={commits} />
        </div>
      </div>
      {fork && <ForkDialog ns={ns} from={fork.from} at={fork.at} open onOpenChange={closeFork} />}
      <ConnectAgent ns={ns} open={connecting} onOpenChange={setConnecting} />
    </div>
  );
}

function Details({
  ns,
  main,
  head,
  commits,
}: {
  ns: string;
  main?: string;
  head?: string | null;
  commits: number;
}) {
  const fleet = useFleet({ ns });
  const [namespaces] = useQuery(queries.namespaces());
  const searchOn = useSearchOn(ns);
  const region = namespaces.find((n) => n.name === ns)?.region;
  const open = fleet.reviews.filter((review) => review.state === "open").length;

  return (
    <aside className="panel grid gap-6 p-6 text-sm">
      {main && (
        <Fact label="Mount">
          <MountLine ns={ns} branch={main} />
        </Fact>
      )}
      {region && (
        <Fact label="Bucket">
          <BucketBadge region={region} />
        </Fact>
      )}
      <Fact label="Branches" href={nsPath(ns, "branches")}>
        {open ? `${open} open` : plural(fleet.branches.length, "branch")}
      </Fact>
      <Fact label="History" href={nsPath(ns, "history")}>
        {main ? (
          <span className="flex items-baseline gap-1.5">
            {plural(commits, "commit")}
            <Hash value={head} />
          </span>
        ) : (
          "Nothing written yet"
        )}
      </Fact>
      <Fact label="Search" href={nsPath(ns, "search")}>
        {searchOn ? "On" : "Off"}
      </Fact>
    </aside>
  );
}

function Fact({ label, href, children }: { label: string; href?: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      {href ? (
        <Link
          href={href}
          className="w-fit text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {label}
        </Link>
      ) : (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
