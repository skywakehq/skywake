import type { ReactNode } from "react";

import { FolderIcon } from "@/components/ui/folder-icon";
import { cn } from "@/lib/utils";

export type Tally = { label: string; detail: string; total: string; price: string };

const GRID = "grid grid-cols-10 gap-1.5 sm:grid-cols-20 sm:gap-2";

function TallyCard({
  tally,
  badge,
  sun,
  children,
}: {
  tally: Tally;
  badge?: string;
  sun?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("panel reveal flex flex-col p-6 sm:p-8", sun && "panel-sun")}>
      <p className="t-body flex items-center gap-3 font-medium text-foreground">
        {tally.label}
        {badge && (
          <span className="rounded-full bg-(--sun) px-2.5 py-0.5 text-xs text-(--sun-ink)">
            {badge}
          </span>
        )}
      </p>
      <p className="mt-5 flex items-baseline gap-3">
        <span className={cn("t-num", sun ? "text-signal" : "text-foreground")}>{tally.total}</span>
        <span className="t-small text-muted-foreground">{tally.price}</span>
      </p>
      <div aria-hidden className={cn(GRID, "mt-8")}>
        {children}
      </div>
      <p className="t-small mt-6 text-muted-foreground">{tally.detail}</p>
    </div>
  );
}

/** A folder per full copy on one side; one shared folder and the changes on the other. */
export function FolderTally({
  count,
  changes,
  copies,
  ours,
  gap,
}: {
  count: number;
  /** Everyone's changes, in whole folders. */
  changes: number;
  copies: Tally;
  ours: Tally;
  gap: string;
}) {
  const slots = Array.from({ length: count }, (_, i) => i);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TallyCard tally={copies}>
        {slots.map((i) => (
          <FolderIcon key={i} className="w-full opacity-50 grayscale" />
        ))}
      </TallyCard>
      <TallyCard tally={ours} badge={gap} sun>
        {slots.map((i) =>
          i <= changes ? (
            <FolderIcon key={i} className={cn("w-full", i > 0 && "opacity-45")} />
          ) : (
            <span key={i} className="grid aspect-[100/82] place-items-center">
              <span className="size-1 rounded-full bg-foreground/15" />
            </span>
          ),
        )}
      </TallyCard>
    </div>
  );
}
