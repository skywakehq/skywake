"use client";

import {
  Database,
  FileCode,
  FileJson,
  FileText,
  Image as ImageIcon,
  Sheet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

const FADE = {
  maskImage:
    "linear-gradient(to right, transparent, black 10%, black 90%, transparent), linear-gradient(to bottom, black 70%, transparent)",
  maskComposite: "intersect",
} as const;

const ICONS: LucideIcon[] = [FileText, FileCode, Sheet, ImageIcon, FileJson, Database];
const COLS = 7;
const ROWS = 3;
const TILES = COLS * ROWS;

function edits(n: number) {
  const a = (n * 7 + 3) % TILES;
  const b = (n * 11 + 9) % TILES;
  return a === b ? [a] : [a, b];
}

export function ForkArt() {
  const [n, setN] = useState(12);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setN((v) => v + 1), 2600);
    return () => clearInterval(t);
  }, []);

  const edited = edits(n);
  return (
    <div aria-hidden className="relative -mx-6 sm:-mx-8">
      <div className="absolute top-0 left-6 z-10 sm:left-8">
        <p
          key={n}
          className="rise-in inline-flex h-8 items-center gap-2 rounded-md bg-background px-3.5 font-mono text-[12px] text-foreground ring-1 ring-border"
        >
          <span className="size-1.5 rounded-full bg-signal" />
          agent-{n}
          <span className="text-muted-foreground">forked in 10 ms</span>
        </p>
      </div>
      <div
        className="grid gap-2.5 px-2 pt-14"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, ...FADE }}
      >
        {Array.from({ length: TILES }, (_, i) => {
          const Icon = ICONS[(i * 5) % ICONS.length]!;
          const lit = edited.includes(i);
          return (
            <div
              key={i}
              className={`relative grid aspect-[5/4] place-items-center rounded-xl ring-1 transition-all duration-700 ${
                lit
                  ? "bg-[color-mix(in_oklab,var(--signal)_14%,var(--background))] ring-signal/60"
                  : "bg-background ring-border"
              }`}
            >
              <Icon
                strokeWidth={1.5}
                className={`size-5 transition-colors duration-700 ${
                  lit ? "text-signal" : "text-muted-foreground/50"
                }`}
              />
              {lit && (
                <span className="rise-in absolute top-1.5 right-1.5 rounded-full bg-signal px-1.5 font-mono text-[9px] leading-4 text-background">
                  M
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const QUERIES: { q: string; hits: [string, string][] }[] = [
  {
    q: "refunds on annual plans",
    hits: [
      ["billing.md", "0.92"],
      ["terms.md", "0.81"],
      ["faq.md", "0.74"],
    ],
  },
  {
    q: "reset a lost password",
    hits: [
      ["auth.md", "0.94"],
      ["support.md", "0.83"],
      ["login.ts", "0.77"],
    ],
  },
  {
    q: "invoices for teams",
    hits: [
      ["billing.md", "0.89"],
      ["teams.md", "0.85"],
      ["pricing.md", "0.80"],
    ],
  },
];

// A small neighbour graph, the shape vector indexes search over. Built once
// from a fixed seed, so the server and the browser draw the same picture.
const W = 600;
const H = 260;
const NODES: [number, number][] = [];
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
while (NODES.length < 46) {
  const p: [number, number] = [20 + rand() * (W - 40), 16 + rand() * (H - 32)];
  if (NODES.every((q) => dist(p, q) > 42)) NODES.push(p);
}

function dist(a: readonly number[], b: readonly number[]) {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
}

const NEIGHBOURS: number[][] = NODES.map(() => []);
const EDGES: [number, number][] = [];
NODES.forEach((p, i) => {
  NODES.map((q, j) => [dist(p, q), j] as const)
    .sort((a, b) => a[0] - b[0])
    .slice(1, 4)
    .forEach(([, j]) => {
      if (NEIGHBOURS[i]!.includes(j)) return;
      NEIGHBOURS[i]!.push(j);
      NEIGHBOURS[j]!.push(i);
      EDGES.push([i, j]);
    });
});

const ENTRY = NODES.reduce(
  (best, p, i) => (dist(p, [30, 240]) < dist(NODES[best]!, [30, 240]) ? i : best),
  0,
);

// Walk from the entry node to the neighbour closest to the query, like a real
// graph search, then return the path and the three nearest results.
function search(target: readonly [number, number]) {
  const path = [ENTRY];
  for (;;) {
    const here = path.at(-1)!;
    const next = NEIGHBOURS[here]!.reduce(
      (best, j) => (dist(NODES[j]!, target) < dist(NODES[best]!, target) ? j : best),
      here,
    );
    if (next === here) break;
    path.push(next);
  }
  const end = path.at(-1)!;
  const near = [...NEIGHBOURS[end]!].sort(
    (a, b) => dist(NODES[a]!, target) - dist(NODES[b]!, target),
  );
  return { path, results: [end, ...near.slice(0, 2)] };
}

const TARGETS = [
  [470, 80],
  [540, 200],
  [360, 140],
] as const;
const SEARCHES = TARGETS.map(search);

export function SearchArt() {
  const [k, setK] = useState(0);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setK((v) => (v + 1) % QUERIES.length), 3600);
    return () => clearInterval(t);
  }, []);

  const { q, hits } = QUERIES[k]!;
  const { path, results } = SEARCHES[k]!;
  const end = results[0]!;
  return (
    <div aria-hidden className="relative">
      <p
        key={q}
        className="rise-in inline-flex h-8 items-center gap-2 rounded-md bg-background px-3.5 font-mono text-[12px] text-foreground ring-1 ring-border"
      >
        <span className="size-1.5 rounded-full bg-signal" />
        {q}
        <span className="text-muted-foreground">411 ms</span>
      </p>
      <div className="relative mt-4 aspect-[600/260]" style={FADE}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full">
          <g className="stroke-muted-foreground/25" strokeWidth={1}>
            {EDGES.map(([a, b]) => (
              <line
                key={`${a}-${b}`}
                x1={NODES[a]![0]}
                y1={NODES[a]![1]}
                x2={NODES[b]![0]}
                y2={NODES[b]![1]}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <g className="fill-muted-foreground/45">
            {NODES.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={2.5} />
            ))}
          </g>
          <g key={q} className="stroke-signal fill-signal">
            <polyline
              points={path.map((i) => NODES[i]!.join(",")).join(" ")}
              pathLength={1}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              className="draw-line"
            />
            {results.slice(1).map((i) => (
              <line
                key={i}
                x1={NODES[end]![0]}
                y1={NODES[end]![1]}
                x2={NODES[i]![0]}
                y2={NODES[i]![1]}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                className="rise-in"
                style={{ animationDelay: "0.9s" }}
              />
            ))}
            {path.map((i, n) => (
              <circle
                key={i}
                cx={NODES[i]![0]}
                cy={NODES[i]![1]}
                r={i === end ? 5 : 3}
                stroke="none"
                className="rise-in"
                style={{ animationDelay: `${(n / path.length) * 0.8}s` }}
              />
            ))}
            {results.slice(1).map((i) => (
              <circle
                key={`r${i}`}
                cx={NODES[i]![0]}
                cy={NODES[i]![1]}
                r={4}
                stroke="none"
                className="rise-in"
                style={{ animationDelay: "0.9s" }}
              />
            ))}
          </g>
        </svg>
        {results.map((i, n) => {
          const [x, y] = NODES[i]!;
          const [file, score] = hits[n]!;
          return (
            <span
              key={`${q}-${i}`}
              className={`rise-in absolute flex -translate-y-1/2 items-center gap-1.5 rounded-md bg-background px-2 py-0.5 font-mono text-[11px] whitespace-nowrap ring-1 ring-border ${
                x > W * 0.7 ? "-translate-x-[calc(100%+10px)]" : "translate-x-[10px]"
              }`}
              style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, animationDelay: "1s" }}
            >
              <span className="text-signal">{n + 1}</span>
              <span className="text-foreground">{file}</span>
              <span className="text-muted-foreground">{score}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
