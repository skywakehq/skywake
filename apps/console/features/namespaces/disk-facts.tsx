"use client";

import { Check, Copy, Database } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "@/components/kit";
import { city } from "@/features/environments/regions";
import { diskApi, v2 } from "@/lib/v2";

const OWN_BUCKET = "bucket:";

/** The bucket a disk lives in: a store badge and where it is. */
export function BucketBadge({ region, className }: { region: string; className?: string }) {
  const own = region.startsWith(OWN_BUCKET);
  return (
    <span title={own ? undefined : region} className={cx("flex items-center gap-1.5", className)}>
      <span className="grid size-4 shrink-0 place-items-center rounded-[5px] bg-tint">
        <Database className="size-2.5 text-foreground" />
      </span>
      {own ? "Your bucket" : city(region)}
    </span>
  );
}

/** Whether search is on for a disk, once the API answers. */
export function useSearchOn(ns: string) {
  const [on, setOn] = useState<boolean>();
  useEffect(() => {
    let live = true;
    const [env, path] = diskApi(ns);
    v2<{ search: boolean }>(env, "GET", path).then(
      (disk) => live && setOn(disk.search),
      () => live && setOn(undefined),
    );
    return () => {
      live = false;
    };
  }, [ns]);
  return on;
}

/** The command that mounts a disk, with a button to copy it. */
export function MountLine({ ns, branch = "main" }: { ns: string; branch?: string }) {
  const [copied, setCopied] = useState(false);
  const command = `skywake mount ${ns}@${branch} /mnt/skywake`;
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(command);
        setCopied(true);
      }}
      className="flex h-8 max-w-full items-center gap-2.5 rounded-full bg-hover px-3.5 font-mono text-xs text-foreground transition-colors hover:bg-active"
    >
      <span className="text-faint">$</span>
      <span className="truncate">{command}</span>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}
