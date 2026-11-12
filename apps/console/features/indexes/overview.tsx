"use client";

import { useState } from "react";
import { Choice, Panel, cx } from "@/components/kit";
import { indexApi } from "@/lib/paths";
import { city } from "@/features/environments/regions";
import { type IndexInfo, type Stats, type UsageDay, branchUrl, bytes, useApi } from "./api";
import { Label } from "./fields";

const FIGURES: { key: keyof Stats; label: string }[] = [
  { key: "rows", label: "Rows" },
  { key: "indexed_rows", label: "Indexed" },
  { key: "unindexed_rows", label: "Unindexed" },
  { key: "deleted_rows", label: "Deleted" },
  { key: "segments", label: "Segments" },
  { key: "clusters", label: "Clusters" },
];

/** A branch's counts, then the schema. */
export function Overview({ index, branch }: { index: IndexInfo; branch: string }) {
  const { loaded } = useApi<{ stats: Stats | null }>(branchUrl(index.name, branch));
  const stats = loaded.state === "done" ? loaded.value.stats : undefined;

  return (
    <div className="grid gap-10">
      <div className="grid grid-cols-2 gap-x-10 gap-y-6 border-b pb-8 sm:grid-cols-4 lg:grid-cols-7">
        {FIGURES.map(({ key, label }) => (
          <Figure key={key} label={label} value={stats ? stats[key].toLocaleString() : undefined} />
        ))}
        <Figure label="Size" value={stats ? bytes(stats.bytes) : undefined} />
      </div>
      {stats === null && (
        <p className="-mt-6 text-sm text-muted-foreground">
          This server does not count rows yet. Queries and writes work as usual.
        </p>
      )}
      {loaded.state === "failed" && <p className="text-sm text-destructive">{loaded.error}</p>}

      <Usage index={index.name} />

      <Panel title="Vector columns" count={index.schema.vectors.length}>
        {index.schema.vectors.map((column) => (
          <Row
            key={column.name}
            name={column.name}
            detail={`${column.dims} dims · ${column.metric}`}
          />
        ))}
      </Panel>
      <Panel title="Attributes" count={index.schema.attributes.length}>
        {index.schema.attributes.length ? (
          index.schema.attributes.map((column) => (
            <Row key={column.name} name={column.name} detail={column.type} />
          ))
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">No attributes.</p>
        )}
      </Panel>
      <p className="text-xs text-faint">
        In {city(index.region)} ({index.region}), made{" "}
        {new Date(index.created).toLocaleDateString()}.
      </p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value?: string }) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <span className="text-[22px] leading-8 font-medium tracking-[-0.02em] whitespace-nowrap tabular-nums">
        {value ?? "—"}
      </span>
    </div>
  );
}

function Row({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="flex h-10 items-center gap-4 border-b border-border/60 px-4 last:border-0">
      <span className="flex-1 font-mono text-sm">{name}</span>
      <span className="font-mono text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

const DAYS = 14;

type Measure = "queries" | "writes" | "rows" | "bytes";

const MEASURES: { value: Measure; label: string; note: string }[] = [
  { value: "queries", label: "Queries", note: "on every branch" },
  { value: "writes", label: "Writes", note: "documents written and deleted, every branch" },
  { value: "rows", label: "Rows", note: "live documents of main" },
  { value: "bytes", label: "Size", note: "stored bytes of main" },
];

/**
 * The index's last two weeks. Rows and size are counted when someone looks
 * at the index, so a day nobody did keeps the day before's numbers.
 */
function Usage({ index }: { index: string }) {
  const { loaded } = useApi<{ days: UsageDay[] }>(indexApi(index, `usage?days=${DAYS}`));
  const [measure, setMeasure] = useState<Measure>("queries");
  const [hover, setHover] = useState<number | null>(null);
  const days = loaded.state === "done" ? carried(loaded.value.days) : null;

  const valueOf = (day: UsageDay) =>
    measure === "writes" ? day.writes + day.deletes : (day[measure] ?? 0);
  const show = (n: number) => (measure === "bytes" ? bytes(n) : n.toLocaleString());
  const most = Math.max(1, ...(days ?? []).map(valueOf));
  const shown = hover === null || !days ? null : days[hover]!;
  const total = (days ?? []).reduce((sum, day) => sum + valueOf(day), 0);
  const label = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const note = MEASURES.find((m) => m.value === measure)!.note;

  return (
    <Panel
      title="Last 14 days"
      action={
        <Choice
          value={measure}
          onChange={(m) => (setHover(null), setMeasure(m))}
          options={MEASURES}
        />
      }
    >
      <div className="px-4 pt-4 pb-3">
        <div className="flex h-5 items-baseline gap-2 text-xs text-muted-foreground tabular-nums">
          {shown ? (
            <>
              <span className="text-foreground">{label(shown.day)}</span>
              {measure === "writes" ? (
                <span>
                  {shown.writes.toLocaleString()} written, {shown.deletes.toLocaleString()} deleted
                </span>
              ) : (
                <span>{shown[measure] === null ? "not counted" : show(valueOf(shown))}</span>
              )}
            </>
          ) : measure === "queries" || measure === "writes" ? (
            <span>
              <span className="text-foreground">{total.toLocaleString()}</span> in 14 days · {note}
            </span>
          ) : (
            <span>
              <span className="text-foreground">{days ? show(valueOf(days.at(-1)!)) : "—"}</span>{" "}
              today · {note}
            </span>
          )}
        </div>
        {loaded.state === "failed" ? (
          <p className="py-10 text-sm text-destructive">{loaded.error}</p>
        ) : (
          <div
            className="relative mt-3 flex h-40 items-end gap-1"
            onMouseLeave={() => setHover(null)}
          >
            {[0.5, 1].map((line) => (
              <span
                key={line}
                aria-hidden
                className="absolute inset-x-0 border-t border-dashed border-line/70"
                style={{ bottom: `${line * 100}%` }}
              />
            ))}
            {(days ?? Array.from({ length: DAYS }, () => null)).map((day, i) => {
              const value = day ? valueOf(day) : 0;
              return (
                <div
                  key={day?.day ?? i}
                  onMouseEnter={() => setHover(i)}
                  className="relative z-10 flex h-full flex-1 items-end"
                  aria-label={day ? `${label(day.day)}: ${show(value)}` : undefined}
                >
                  <div
                    className={cx(
                      "flex w-full flex-col justify-end overflow-hidden rounded-t-[3px] transition-[height,opacity]",
                      !day && "animate-pulse bg-muted",
                      hover !== null && hover !== i && "opacity-40",
                    )}
                    style={{
                      height: day ? `${(value / most) * 100}%` : "20%",
                      minHeight: value ? 3 : 0,
                    }}
                  >
                    {day && measure === "writes" ? (
                      <>
                        <div
                          className="bg-fg/25"
                          style={{ height: `${value ? (day.deletes / value) * 100 : 0}%` }}
                        />
                        <div className="flex-1 bg-fg/85" />
                      </>
                    ) : (
                      day && (
                        <div
                          className={cx(
                            "flex-1",
                            day.counted || measure === "queries" ? "bg-fg/85" : "bg-fg/25",
                          )}
                        />
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs text-faint">
          <span>{days ? label(days[0]!.day) : ""}</span>
          {measure === "writes" && (
            <span className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-fg/85" /> Written
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-fg/25" /> Deleted
              </span>
            </span>
          )}
          <span>Today</span>
        </div>
      </div>
    </Panel>
  );
}

/** Rows and bytes of a day not counted are the day before's, drawn lighter. */
function carried(days: UsageDay[]) {
  let rows: number | null = null;
  let size: number | null = null;
  return days.map((day) => {
    const counted = day.rows !== null;
    rows = day.rows ?? rows;
    size = day.bytes ?? size;
    return { ...day, rows, bytes: size, counted };
  });
}
