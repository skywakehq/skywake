"use client";

import { Sparkles, Type } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Choice, Panel, cx } from "@/components/kit";
import { useUrls } from "@/components/shell/console";
import { city } from "@/features/environments/regions";
import { indexApi } from "@/lib/paths";
import {
  type AttributeColumn,
  type IndexInfo,
  type Stats,
  type UsageDay,
  type VectorColumn,
  branchUrl,
  bytes,
  useApi,
} from "./api";
import { CopyIcon } from "./code";
import { Label } from "./fields";
import { Start } from "./start";

type Loaded<T> = ReturnType<typeof useApi<T>>["loaded"];

export function Overview({ index, branch }: { index: IndexInfo; branch: string }) {
  const stats = useApi<{ stats: Stats | null }>(branchUrl(index.name, branch));
  const usage = useApi<{ days: UsageDay[] }>(indexApi(index.name, `usage?days=${DAYS}`));
  const counted = stats.loaded.state === "done" ? stats.loaded.value.stats : undefined;
  const days = usage.loaded.state === "done" ? usage.loaded.value.days : undefined;
  const total = (pick: (day: UsageDay) => number) =>
    days ? days.reduce((sum, day) => sum + pick(day), 0) : undefined;
  const queries = total((day) => day.queries);
  const writes = total((day) => day.writes + day.deletes);
  const written = !!counted && counted.rows > 0;
  const queried = (queries ?? 0) > 0;
  const fresh = counted?.rows === 0;
  const guiding =
    counted !== undefined && queries !== undefined && !(written && queried) && counted !== null;

  function reload() {
    stats.reload();
    usage.reload();
  }

  return (
    <div className="grid gap-10">
      {guiding && (
        <Start
          index={index}
          branch={branch}
          written={written}
          queried={queried}
          onWritten={reload}
        />
      )}

      {!fresh && (
        <>
          <div className="grid gap-6">
            <div className="grid grid-cols-2 gap-x-10 gap-y-6 md:grid-cols-4">
              <Figure label="Documents" value={counted?.rows.toLocaleString()} />
              <Figure label="Size" value={counted ? bytes(counted.bytes) : undefined} />
              <Figure label="Queries" hint="14 days" value={queries?.toLocaleString()} />
              <Figure label="Writes" hint="14 days" value={writes?.toLocaleString()} />
            </div>
            {counted && <Health stats={counted} />}
            {counted === null && (
              <p className="text-sm text-muted-foreground">
                This server does not count rows yet. Queries and writes work as usual.
              </p>
            )}
            {stats.loaded.state === "failed" && (
              <p className="text-sm text-destructive">{stats.loaded.error}</p>
            )}
          </div>
          <Usage loaded={usage.loaded} />
        </>
      )}

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Schema index={index} />
        <Connect index={index} branch={branch} />
      </div>
    </div>
  );
}

function Figure({ label, hint, value }: { label: string; hint?: string; value?: string }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline gap-1.5">
        <Label>{label}</Label>
        {hint && <span className="text-xs text-faint">{hint}</span>}
      </div>
      <span
        className={cx(
          "text-[26px] leading-8 font-medium tracking-[-0.025em] whitespace-nowrap tabular-nums",
          value === undefined && "text-faint",
        )}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

function Health({ stats }: { stats: Stats }) {
  const share = stats.rows ? stats.indexed_rows / stats.rows : 1;
  const all = stats.unindexed_rows === 0;
  const none = stats.indexed_rows === 0;
  const details = [
    `${stats.segments.toLocaleString()} segment${stats.segments === 1 ? "" : "s"}`,
    `${stats.clusters.toLocaleString()} cluster${stats.clusters === 1 ? "" : "s"}`,
    stats.deleted_rows > 0 && `${stats.deleted_rows.toLocaleString()} deleted`,
  ].filter(Boolean);
  return (
    <div className="grid gap-2 border-y py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">
          {all
            ? "Every document is indexed"
            : none
              ? "Not indexed yet"
              : `${stats.indexed_rows.toLocaleString()} of ${stats.rows.toLocaleString()} indexed`}
        </span>
        <span className="text-muted-foreground">
          {all
            ? "Searches read the index directly."
            : none
              ? "Searches read every document exactly until the first build."
              : "The rest are read exactly until the next build, so nothing is missed."}
        </span>
        <span className="ml-auto text-xs text-faint tabular-nums">{details.join(" · ")}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full bg-foreground/70 transition-[width] duration-700"
          style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function Schema({ index }: { index: IndexInfo }) {
  const { vectors, attributes } = index.schema;
  return (
    <Panel title="Schema" count={vectors.length + attributes.length}>
      {vectors.map((column) => (
        <VectorRow key={column.name} column={column} />
      ))}
      {attributes.map((column) => (
        <AttributeRow key={column.name} column={column} />
      ))}
      <p className="px-4 pt-3 text-xs text-faint">
        A document may also bring attributes the schema lacks; each is added with its value&apos;s
        type.
      </p>
    </Panel>
  );
}

function SchemaRow({ name, kind, children }: { name: string; kind: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2">
      <span className="font-mono text-[13px]">{name}</span>
      <Chip>{kind}</Chip>
      <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

function VectorRow({ column }: { column: VectorColumn }) {
  return (
    <SchemaRow name={column.name} kind="vector">
      <span className="tabular-nums">{column.dims} dims</span>
      <span className="text-faint">·</span>
      <span>{column.metric}</span>
      {column.embed && (
        <Chip strong>
          <Sparkles className="size-3" aria-hidden />
          {column.embed.model}
          {column.embed.from && <span className="text-faint">from {column.embed.from}</span>}
        </Chip>
      )}
    </SchemaRow>
  );
}

const USES: Record<AttributeColumn["type"], string> = {
  string: "eq, in, lt, gt",
  number: "eq, in, lt, gt",
  bool: "eq, in",
  strings: "any of a list",
  text: "keyword search",
};

function AttributeRow({ column }: { column: AttributeColumn }) {
  return (
    <SchemaRow name={column.name} kind={column.type}>
      {column.type === "text" && <Type className="size-3.5" aria-hidden />}
      <span>{USES[column.type]}</span>
    </SchemaRow>
  );
}

function Chip({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={cx(
        "rounded-md inline-flex h-5 items-center gap-1 px-1.5 text-[11px] leading-none",
        strong ? "bg-foreground/[0.08] text-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Connect({ index, branch }: { index: IndexInfo; branch: string }) {
  const api = useUrls().api;
  const facts: [string, string, boolean][] = [
    ["Name", index.name, true],
    ["Endpoint", `${api}/v1/indexes/${encodeURIComponent(index.name)}`, true],
    ["Branch", branch, false],
    ["Region", `${city(index.region)} · ${index.region}`, false],
    [
      "Created",
      new Date(index.created).toLocaleDateString(undefined, { dateStyle: "long" }),
      false,
    ],
  ];
  return (
    <Panel title="Connect" className="min-w-0">
      <dl className="grid grid-cols-[minmax(0,1fr)]">
        {facts.map(([label, value, copies]) => (
          <div
            key={label}
            className="group flex min-h-11 items-center gap-3 border-b border-border/60 px-4 py-2 last:border-0"
          >
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
            <dd
              className={cx("min-w-0 flex-1 truncate text-[13px]", copies && "font-mono")}
              title={value}
            >
              {value}
            </dd>
            {copies && (
              <CopyIcon
                text={value}
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              />
            )}
          </div>
        ))}
      </dl>
    </Panel>
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
function Usage({ loaded }: { loaded: Loaded<{ days: UsageDay[] }> }) {
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
            className="relative mt-3 flex h-40 items-end gap-1.5"
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
                  className="relative z-10 flex h-full flex-1 items-end justify-center"
                  aria-label={day ? `${label(day.day)}: ${show(value)}` : undefined}
                >
                  <div
                    className={cx(
                      "flex w-full max-w-7 flex-col justify-end overflow-hidden rounded-t-[4px] transition-[height,opacity]",
                      !day && "animate-pulse bg-muted",
                      day && !value && "bg-fg/10",
                      hover !== null && hover !== i && "opacity-40",
                    )}
                    style={{
                      height: day ? `${(value / most) * 100}%` : "20%",
                      minHeight: day ? 2 : 0,
                    }}
                  >
                    {day && measure === "writes" ? (
                      <>
                        <div
                          className="bg-fg/25"
                          style={{ height: `${value ? (day.deletes / value) * 100 : 0}%` }}
                        />
                        <div className="flex-1 bg-fg/70" />
                      </>
                    ) : (
                      day && (
                        <div
                          className={cx(
                            "flex-1",
                            day.counted || measure === "queries" ? "bg-fg/70" : "bg-fg/25",
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
                <span className="size-2 rounded-sm bg-fg/70" /> Written
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
