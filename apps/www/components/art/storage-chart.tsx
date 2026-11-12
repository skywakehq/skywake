"use client";

import { useState, type PointerEvent } from "react";

const W = 640;
const H = 340;
const PAD = { top: 24, right: 96, bottom: 40, left: 52 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export type StorageSeries = { label: string; baseGb: number; gbPerAgent: number; ours?: boolean };

const gbAt = (s: StorageSeries, agents: number) => s.baseGb + s.gbPerAgent * agents;

const gb = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} TB` : `${Math.round(n)} GB`);

export function StorageChart({
  maxAgents,
  series,
}: {
  maxAgents: number;
  series: StorageSeries[];
}) {
  const [agents, setAgents] = useState<number | null>(null);
  const maxGb = Math.max(...series.map((s) => gbAt(s, maxAgents)));
  const x = (n: number) => PAD.left + (n / maxAgents) * PLOT_W;
  const y = (v: number) => PAD.top + PLOT_H - (v / maxGb) * PLOT_H;
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxAgents));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxGb);

  function onMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const n = Math.round(((px - PAD.left) / PLOT_W) * maxAgents);
    setAgents(Math.min(maxAgents, Math.max(1, n)));
  }

  return (
    <figure className="relative">
      <figcaption className="t-mono flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className={`h-0.5 w-4 rounded-full ${s.ours ? "bg-signal" : "bg-muted-foreground"}`}
            />
            {s.label}
          </span>
        ))}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Storage for 1 to ${maxAgents} agents. ${series
          .map((s) => `${s.label}: ${gb(gbAt(s, maxAgents))} at ${maxAgents} agents`)
          .join(". ")}.`}
        className="mt-4 block w-full touch-none overflow-visible"
        onPointerMove={onMove}
        onPointerLeave={() => setAgents(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            <text
              x={PAD.left - 10}
              y={y(v)}
              dy="0.32em"
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {gb(v)}
            </text>
          </g>
        ))}
        {xTicks.map((n) => (
          <text
            key={n}
            x={x(n)}
            y={H - PAD.bottom + 22}
            textAnchor="middle"
            className="fill-muted-foreground text-[11px]"
          >
            {n === maxAgents ? `${n} agents` : n}
          </text>
        ))}

        {series.map((s) => (
          <g key={s.label}>
            <line
              x1={x(0)}
              y1={y(gbAt(s, 0))}
              x2={x(maxAgents)}
              y2={y(gbAt(s, maxAgents))}
              strokeWidth={2}
              strokeLinecap="round"
              className={s.ours ? "stroke-signal" : "stroke-muted-foreground"}
            />
            <circle
              cx={x(maxAgents)}
              cy={y(gbAt(s, maxAgents))}
              r={4}
              strokeWidth={2}
              className={`stroke-card ${s.ours ? "fill-signal" : "fill-muted-foreground"}`}
            />
            <text
              x={x(maxAgents) + 12}
              y={y(gbAt(s, maxAgents))}
              dy="0.32em"
              className="fill-foreground text-[12px] font-medium"
            >
              {gb(gbAt(s, maxAgents))}
            </text>
          </g>
        ))}

        {agents !== null && (
          <g>
            <line
              x1={x(agents)}
              x2={x(agents)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              stroke="var(--foreground)"
              strokeOpacity={0.25}
            />
            {series.map((s) => (
              <circle
                key={s.label}
                cx={x(agents)}
                cy={y(gbAt(s, agents))}
                r={4.5}
                strokeWidth={2}
                className={`stroke-card ${s.ours ? "fill-signal" : "fill-muted-foreground"}`}
              />
            ))}
          </g>
        )}
      </svg>
      {agents !== null && (
        <div
          className="t-mono pointer-events-none absolute top-10 rounded-md bg-background px-3 py-2 text-foreground ring-1 ring-border"
          style={{
            left: `${(x(agents) / W) * 100}%`,
            transform:
              agents > maxAgents / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
          }}
        >
          <p className="text-muted-foreground">{agents} agents</p>
          {series.map((s) => (
            <p key={s.label} className="mt-1 flex items-center gap-2 whitespace-nowrap">
              <span
                aria-hidden
                className={`h-0.5 w-3 rounded-full ${s.ours ? "bg-signal" : "bg-muted-foreground"}`}
              />
              {s.label}
              <span className="ml-auto pl-4 tabular-nums">{gb(gbAt(s, agents))}</span>
            </p>
          ))}
        </div>
      )}
    </figure>
  );
}
