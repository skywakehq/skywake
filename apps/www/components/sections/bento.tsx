import type { ReactNode } from "react";

import {
  BranchMerge,
  BucketStores,
  CrashSwap,
  MeaningSearch,
  ToolDemo,
} from "@/components/art/bento-art";
import { PlayCard } from "@/components/art/play";
import { Fire } from "@/components/ui/fire";
import { Band, Title } from "@/components/ui/frame";
import { Head } from "@/components/ui/statement";
import type { HomeMessages } from "@/content/messages";
import { files } from "@/content/numbers";
import { cn } from "@/lib/utils";

function Feature({
  item,
  className,
  children,
}: {
  item: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <PlayCard className={cn("panel reveal flex flex-col p-5 sm:p-7", className)}>
      <div className="flex h-44">{children}</div>
      <h3 className="t-h3 mt-6 text-foreground">{item}</h3>
    </PlayCard>
  );
}

/** The feature grid: what the disk does beyond a plain folder. */
export function Bento({ t }: { t: HomeMessages }) {
  const b = t.bento;
  const [tools, crash, merge, bucket, meaning] = b.items;
  const safety = files.groups[1]!.stats;
  return (
    <>
      <Head
        id="features"
        line={b.line}
        eyebrow={b.label}
        title={
          <>
            <Title before={b.titleBefore} accent={b.titleAccent} /> <Fire />
          </>
        }
      />
      <Band>
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
          <Feature item={tools!} className="lg:col-span-2">
            <ToolDemo />
          </Feature>
          <Feature item={meaning!} className="lg:col-span-2">
            <MeaningSearch />
          </Feature>
          <Feature item={merge!} className="md:col-span-2 lg:col-span-2">
            <BranchMerge />
          </Feature>
          <Feature item={crash!} className="lg:col-span-3">
            <CrashSwap figures={safety.map((stat) => stat.figure)} labels={b.crash} />
          </Feature>
          <Feature item={bucket!} className="lg:col-span-3">
            <BucketStores />
          </Feature>
        </ul>
      </Band>
    </>
  );
}
