// Two bars drawn to the same scale: a full copy per agent, and Skywake's
// one shared copy plus each agent's changes.

export type StorageBar = { label: string; detail: string; total: string; price: string };

const TINT = "bg-[color-mix(in_oklab,var(--signal)_9%,var(--card))]";

export function StorageBars({
  copies,
  ours,
  count,
  sharedShare,
  changesShare,
  gap,
}: {
  copies: StorageBar;
  ours: StorageBar;
  /** How many agents, so how many blocks the top bar has. */
  count: number;
  /** Skywake's shared copy and changes, as a share of the top bar (0 to 1). */
  sharedShare: number;
  changesShare: number;
  gap: string;
}) {
  return (
    <div className="grid gap-3">
      <div className="rounded-xl p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="t-body text-muted-foreground">{copies.label}</p>
          <p className="t-mono text-muted-foreground tabular-nums">
            <span className="text-foreground">{copies.total}</span> · {copies.price}
          </p>
        </div>
        <div aria-hidden className="mt-3 flex h-10 gap-px">
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className="flex-1 bg-muted-foreground/35" />
          ))}
        </div>
        <p className="t-mono mt-2.5 text-muted-foreground">{copies.detail}</p>
      </div>

      <div className={`rounded-xl p-5 ${TINT}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="t-body font-medium text-foreground">{ours.label}</p>
          <p className="t-mono flex items-baseline gap-3 tabular-nums">
            <span className="rounded-md bg-signal px-2 py-0.5 text-[12px] font-medium text-background">
              {gap}
            </span>
            <span>
              <span className="font-medium text-signal">{ours.total}</span>
              <span className="text-muted-foreground"> · {ours.price}</span>
            </span>
          </p>
        </div>
        {/* A faint track the full width of the top bar keeps the true scale visible. */}
        <div aria-hidden className="mt-3 flex h-10 gap-px bg-foreground/5">
          <span className="bg-signal" style={{ width: `${sharedShare * 100}%` }} />
          <span className="bg-signal/45" style={{ width: `${changesShare * 100}%` }} />
        </div>
        <p className="t-mono mt-2.5 text-foreground">{ours.detail}</p>
      </div>
    </div>
  );
}
