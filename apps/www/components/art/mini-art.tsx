"use client";

import { useEffect, useState, type ReactNode } from "react";

function useTick(ms: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setN((v) => v + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

const PANEL = "rounded-xl bg-background ring-1 ring-border";
const LIT =
  "bg-[color-mix(in_oklab,var(--signal)_14%,var(--background))] ring-1 ring-signal/60 text-signal";

function Pill({
  children,
  note,
  className = "",
}: {
  children: ReactNode;
  note?: string;
  className?: string;
}) {
  return (
    <p
      className={`rise-in inline-flex h-8 w-fit items-center gap-2 rounded-md bg-background px-3.5 font-mono text-[12px] whitespace-nowrap text-foreground ring-1 ring-border ${className}`}
    >
      <span className="size-1.5 rounded-full bg-signal" />
      {children}
      {note && <span className="text-muted-foreground">{note}</span>}
    </p>
  );
}

const POINTS = (() => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 260 }, () => [rand() * 600, rand() * 240] as const);
})();
const TARGETS = [
  [330, 150],
  [270, 130],
  [310, 175],
] as const;
const QUERIES = ["refunds on annual plans", "reset a lost password", "invoices for teams"];

function VectorMini() {
  const n = useTick(3600);
  const [tx, ty] = TARGETS[n % TARGETS.length]!;
  const near = POINTS.map(([x, y], i) => [Math.hypot(x - tx, y - ty), i] as const)
    .sort((a, b) => a[0] - b[0])
    .slice(0, 6)
    .map(([, i]) => i);
  const [bx, by] = POINTS[near[0]!]!;
  return (
    <>
      <svg
        viewBox="0 0 600 240"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        {POINTS.map(([x, y], i) =>
          near.includes(i) ? null : (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={1.6}
              className="fill-muted-foreground"
              opacity={0.15 + ((i * 13) % 10) / 25}
            />
          ),
        )}
        <g key={n} className="rise-in">
          {near.map((i) => {
            const [x, y] = POINTS[i]!;
            return (
              <g key={i}>
                <line x1={bx} y1={by} x2={x} y2={y} stroke="var(--signal)" strokeOpacity={0.5} />
                <circle cx={x} cy={y} r={7} fill="var(--signal)" opacity={0.15} />
                <circle cx={x} cy={y} r={i === near[0] ? 3.5 : 2.6} fill="var(--signal)" />
              </g>
            );
          })}
        </g>
      </svg>
      <Pill key={n} note="411 ms" className="absolute top-5 left-6">
        {QUERIES[n % QUERIES.length]}
      </Pill>
    </>
  );
}

const WORDS = ["refund", "invoice", "password"];
const TEXT = [
  "a refund is issued to the card used, within 5 days",
  "every invoice lists the plan, the seats and the tax",
  "to reset a password, open settings and pick security",
  "annual plans can ask for a refund in the first month",
  "teams get one invoice for all seats, billed monthly",
];

function FullTextMini() {
  const n = useTick(2600);
  const word = WORDS[n % WORDS.length]!;
  return (
    <div className="grid w-full gap-4 px-6">
      <Pill key={n} note="bm25">
        {word}
      </Pill>
      <div className="grid gap-2 font-mono text-[11px] whitespace-nowrap text-muted-foreground/60">
        {TEXT.map((line) => (
          <p key={line}>
            {line.split(" ").map((w, i) => (
              <span
                key={i}
                className={`rounded transition-colors duration-700 ${w === word ? "bg-signal/15 text-signal" : ""}`}
              >
                {w}{" "}
              </span>
            ))}
          </p>
        ))}
      </div>
    </div>
  );
}

const RANKS = {
  vector: ["billing.md", "faq.md", "terms.md"],
  bm25: ["terms.md", "billing.md", "plans.md"],
  fused: ["billing.md", "terms.md", "faq.md"],
};

function HybridMini() {
  const n = useTick(3000);
  return (
    <div className="flex gap-3 justify-self-start px-6">
      {(["vector", "bm25", "fused"] as const).map((k) => (
        <div key={k} className={`w-36 shrink-0 p-2 ${k === "fused" ? `rounded-xl ${LIT}` : PANEL}`}>
          <p
            className={`px-1.5 pb-1.5 font-mono text-[10px] ${k === "fused" ? "text-signal" : "text-muted-foreground"}`}
          >
            {k}
          </p>
          <ol key={k === "fused" ? n : k} className="grid gap-1">
            {RANKS[k].map((f, i) => (
              <li
                key={f}
                className={`flex h-6 items-center gap-2 rounded-md px-1.5 font-mono text-[11px] ${
                  k === "fused" ? "rise-in bg-background text-foreground" : "text-foreground"
                }`}
                style={k === "fused" ? { animationDelay: `${i * 0.12}s` } : undefined}
              >
                <span className={k === "fused" ? "text-signal" : "text-muted-foreground"}>
                  {i + 1}
                </span>
                {f}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function SparseMini() {
  const n = useTick(2200);
  const terms: Record<number, string> = {};
  [4, 11, 17, 26].forEach(
    (c, i) => (terms[(c + n * 3 * (i + 1)) % 30] = ["refund", "annual", "plan", "card"][i]!),
  );
  return (
    <div className="flex h-36 w-full items-end gap-1.5 px-6">
      {Array.from({ length: 30 }, (_, c) => (
        <div key={c} className="relative flex flex-1 flex-col items-center justify-end">
          {terms[c] && (
            <span className="rise-in absolute -top-5 font-mono text-[10px] whitespace-nowrap text-signal">
              {terms[c]}
            </span>
          )}
          <span
            className={`w-full rounded-xs transition-all duration-700 ${terms[c] ? "bg-signal" : "bg-muted-foreground/15"}`}
            style={{ height: terms[c] ? 40 + ((c * 17) % 60) : 4 }}
          />
        </div>
      ))}
    </div>
  );
}

const Q_TOKENS = ["reset", "lost", "password"];

function LateMini() {
  const n = useTick(2400);
  return (
    <div className="grid gap-2 justify-self-start px-6">
      {Q_TOKENS.map((t, r) => {
        const best = 3 + ((r * 5 + n * 3) % 9);
        return (
          <div key={t} className="flex items-center gap-1.5">
            <span className="w-20 shrink-0 font-mono text-[11px] text-foreground">{t}</span>
            {Array.from({ length: 24 }, (_, c) => (
              <span
                key={c}
                className={`size-5 shrink-0 rounded-md transition-colors duration-700 ${
                  c === best
                    ? "bg-signal"
                    : (c * 7 + r * 3 + n) % 5 === 0
                      ? "bg-muted-foreground/25"
                      : "bg-muted-foreground/10"
                }`}
              />
            ))}
          </div>
        );
      })}
      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
        maxsim <span className="text-signal">0.91</span>
      </p>
    </div>
  );
}

const TEAMS = ["infra", "search", "billing", "docs", "growth", "mobile", "web"];

function AnalyticsMini() {
  const n = useTick(2600);
  const counts = TEAMS.map((_, i) => 20 + ((i * 37 + n * 23) % 80));
  const top = counts.indexOf(Math.max(...counts));
  return (
    <div className="flex h-40 w-full items-end gap-3 px-6">
      {TEAMS.map((team, i) => (
        <div key={team} className="flex min-w-12 flex-1 flex-col items-center gap-2">
          <span
            className={`font-mono text-[10px] ${i === top ? "text-signal" : "text-muted-foreground"}`}
          >
            {counts[i]}k
          </span>
          <span
            className={`w-full rounded-lg transition-all duration-700 ${i === top ? LIT : PANEL}`}
            style={{ height: counts[i] }}
          />
          <span className="font-mono text-[10px] text-muted-foreground">{team}</span>
        </div>
      ))}
    </div>
  );
}

const SPLITS = ["exp-rerank", "agent-9", "eval"];

function BranchesMini() {
  const n = useTick(2600);
  const lit = n % SPLITS.length;
  const ys = [40, 100, 160];
  return (
    <svg
      viewBox="0 0 600 220"
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full"
    >
      <line x1={0} y1={100} x2={140} y2={100} className="stroke-border" strokeWidth={2} />
      {ys.map((y, i) => (
        <path
          key={y}
          d={`M140 100 C190 100 190 ${y} 240 ${y} L600 ${y}`}
          fill="none"
          strokeWidth={2}
          stroke={i === lit ? "var(--signal)" : "var(--border)"}
          className="transition-[stroke] duration-500"
        />
      ))}
      <circle
        cx={140}
        cy={100}
        r={7}
        className="fill-background stroke-muted-foreground/50"
        strokeWidth={2}
      />
      <text x={24} y={88} className="fill-muted-foreground font-mono text-[11px]">
        main · 10M
      </text>
      {ys.map((y, i) => (
        <g key={y}>
          <circle
            cx={260}
            cy={y}
            r={i === lit ? 7 : 5}
            strokeWidth={2}
            fill={i === lit ? "var(--signal)" : "var(--background)"}
            className="stroke-muted-foreground/50 transition-all duration-500"
          />
          {i === lit && <circle cx={260} cy={y} r={16} fill="var(--signal)" opacity={0.15} />}
          <text
            x={280}
            y={y - 10}
            className={`font-mono text-[11px] ${i === lit ? "fill-signal" : "fill-muted-foreground"}`}
          >
            {SPLITS[i]}
            {i === lit ? " · forked in 40 ms" : ""}
          </text>
        </g>
      ))}
    </svg>
  );
}

function TimeTravelMini() {
  const n = useTick(1600);
  const versions = 12;
  const at = versions - 1 - (n % 6);
  return (
    <div className="grid w-full gap-4 px-6">
      <Pill key={at} note={`${(10 - (versions - 1 - at) * 0.4).toFixed(1)}M vectors`}>
        as of v{at + 1}
      </Pill>
      <div className="relative mt-4 h-10">
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-border" />
        <div
          className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 rounded-full bg-signal transition-all duration-500"
          style={{ width: `${(at / (versions - 1)) * 100}%` }}
        />
        {Array.from({ length: versions }, (_, v) => (
          <span
            key={v}
            className="absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 justify-items-center"
            style={{ left: `${(v / (versions - 1)) * 100}%` }}
          >
            <span
              className={`size-2 rounded-full ${v <= at ? "bg-signal" : "bg-muted-foreground/30"}`}
            />
            <span className="absolute top-4 font-mono text-[10px] text-muted-foreground">
              v{v + 1}
            </span>
          </span>
        ))}
        <span
          className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background ring-2 ring-signal transition-all duration-500"
          style={{ left: `${(at / (versions - 1)) * 100}%` }}
        />
      </div>
    </div>
  );
}

// The feature pictures, by name.
export type MiniArtName =
  | "vector"
  | "fullText"
  | "hybrid"
  | "sparse"
  | "late"
  | "analytics"
  | "branches"
  | "timeTravel";

const ART: Record<MiniArtName, () => ReactNode> = {
  vector: VectorMini,
  fullText: FullTextMini,
  hybrid: HybridMini,
  sparse: SparseMini,
  late: LateMini,
  analytics: AnalyticsMini,
  branches: BranchesMini,
  timeTravel: TimeTravelMini,
};

export function MiniArt({ name }: { name: MiniArtName }) {
  const Art = ART[name];
  return <Art />;
}
