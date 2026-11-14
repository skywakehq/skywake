"use client";

import {
  Check,
  FileCode,
  FileText,
  Folder,
  GitBranch,
  Image as ImageIcon,
  Lock,
  Sheet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { MiniArtName } from "@/content/products";

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

function ForkMini() {
  const n = useTick(2600);
  const rows = [0, 1, 2, 3].map((i) => n + 12 + i);
  const ys = [22, 66, 110, 154];
  return (
    <div className="flex h-44 items-center">
      <div className="grid shrink-0 place-items-center gap-2">
        <span className={`grid size-14 place-items-center rounded-xl ${PANEL}`}>
          <Folder strokeWidth={1.5} className="size-6 text-muted-foreground" />
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">main</span>
      </div>
      <svg viewBox="0 0 96 176" className="h-44 w-24 shrink-0" fill="none">
        {ys.map((y, i) => (
          <path
            key={y}
            d={`M0 80 C48 80 48 ${y} 96 ${y}`}
            stroke={i === 3 ? "var(--signal)" : "currentColor"}
            className="text-border"
            strokeDasharray={i === 3 ? "4 4" : undefined}
          />
        ))}
      </svg>
      <ol className="grid gap-3">
        {rows.map((a, i) => (
          <li key={a} className="rise-in flex h-8 items-center gap-2">
            <span
              className={`inline-flex h-8 items-center rounded-md px-3 font-mono text-[11px] ${
                i === 3 ? LIT : `${PANEL} text-foreground`
              }`}
            >
              agent-{a}
            </span>
            {[FileText, FileCode, Sheet, ImageIcon].map((Icon, k) => (
              <span key={k} className={`grid size-8 place-items-center rounded-lg ${PANEL}`}>
                <Icon strokeWidth={1.5} className="size-3.5 text-muted-foreground/60" />
              </span>
            ))}
            {i === 3 && <span className="font-mono text-[11px] text-signal">10 ms</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

const TREE = [
  ["docs/", Folder, 0],
  ["report.md", FileText, 1],
  ["data.csv", Sheet, 1],
  ["src/", Folder, 0],
  ["app.ts", FileCode, 1],
] as const;

function MountMini() {
  const n = useTick(2000);
  const open = [1, 2, 4][n % 3];
  return (
    <div className="grid gap-3 font-mono text-[12px]">
      <p className="whitespace-nowrap text-foreground">
        <span className="text-muted-foreground">$</span> skywake mount main ~/work
      </p>
      <ul className={`grid w-56 gap-0.5 p-2 ${PANEL}`}>
        {TREE.map(([name, Icon, depth], i) => (
          <li
            key={name}
            className={`flex h-7 items-center gap-2 rounded-md px-2 text-[11px] transition-colors duration-500 ${
              i === open ? "bg-signal/10 text-signal" : "text-muted-foreground"
            }`}
            style={{ paddingLeft: 8 + depth * 16 }}
          >
            <Icon strokeWidth={1.5} className="size-3.5" />
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

const TYPED = "the refund lands within five days.";

function AutosaveMini() {
  const n = useTick(160);
  const typed = TYPED.slice(0, n % (TYPED.length + 12));
  const saving = n % 13 < 3;
  return (
    <div className={`w-[calc(100%-3rem)] max-w-[26rem] ${PANEL}`}>
      <div className="flex h-10 items-center justify-between border-b border-border px-4 font-mono text-[11px]">
        <span className="text-foreground">notes.md</span>
        <span
          className={`flex items-center gap-1.5 ${saving ? "text-muted-foreground" : "text-signal"}`}
        >
          {saving ? (
            "saving…"
          ) : (
            <>
              <Check className="size-3" strokeWidth={2.5} /> saved
            </>
          )}
        </span>
      </div>
      <div className="grid gap-2 p-4 font-mono text-[11px] text-muted-foreground/70">
        <p>## refunds</p>
        <p>annual plans can ask in the first month,</p>
        <p className="text-foreground">
          {typed}
          <span className="ml-px inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-signal" />
        </p>
      </div>
    </div>
  );
}

const SHELF: [string, LucideIcon][] = [
  ["plan.md", FileText],
  ["app.ts", FileCode],
  ["report.md", FileText],
  ["data.csv", Sheet],
  ["logo.png", ImageIcon],
];

function RecoverMini() {
  const n = useTick(2400);
  const back = n % 2 === 1;
  return (
    <div className="grid justify-items-center gap-6">
      <Pill key={n} note={back ? "from 2 min ago" : undefined}>
        {back ? "restored report.md" : "rm report.md"}
      </Pill>
      <div className="flex gap-3">
        {SHELF.map(([name, Icon], i) => {
          const gone = i === 2 && !back;
          const lit = i === 2 && back;
          return (
            <div key={name} className="grid justify-items-center gap-2">
              <span
                className={`grid h-16 w-20 place-items-center rounded-xl transition-all duration-700 ${
                  gone ? "border border-dashed border-muted-foreground/30" : lit ? LIT : PANEL
                }`}
              >
                <Icon
                  strokeWidth={1.5}
                  className={`size-6 ${lit ? "text-signal" : gone ? "text-muted-foreground/20" : "text-muted-foreground/50"}`}
                />
              </span>
              <span
                className={`font-mono text-[10px] ${lit ? "text-signal" : "text-muted-foreground"}`}
              >
                {name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DIFF = [
  [" ", "## refunds"],
  ["-", "refunds take ten days."],
  ["+", "refunds take five days."],
  [" ", "annual plans can ask"],
  ["+", "in the first month."],
] as const;

function DiffMini() {
  const n = useTick(4000);
  return (
    <div className={`w-[calc(100%-3rem)] max-w-[26rem] ${PANEL}`}>
      <p className="flex h-10 items-center gap-2 border-b border-border px-4 font-mono text-[11px] text-foreground">
        report.md <span className="text-muted-foreground">agent-12 vs main</span>
      </p>
      <div key={n} className="grid gap-0.5 p-2 font-mono text-[11px]">
        {DIFF.map(([sign, text], i) => (
          <p
            key={i}
            style={{ animationDelay: `${i * 0.15}s` }}
            className={`rise-in flex h-6 items-center gap-3 rounded-md px-2 ${
              sign === "+"
                ? "bg-signal/10 text-signal"
                : sign === "-"
                  ? "text-muted-foreground/50 line-through"
                  : "text-muted-foreground"
            }`}
          >
            <span className="w-2 no-underline">{sign}</span>
            {text}
          </p>
        ))}
      </div>
    </div>
  );
}

function MergeMini() {
  const n = useTick(500);
  const step = n % 9;
  const commits = [190, 250, 310, 370];
  const merged = step >= 6;
  return (
    <svg
      viewBox="0 0 600 220"
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full"
    >
      <line x1={0} y1={150} x2={600} y2={150} className="stroke-border" strokeWidth={2} />
      <path
        d="M100 150 C140 150 130 80 170 80 L390 80"
        fill="none"
        className="stroke-border"
        strokeWidth={2}
      />
      <path
        d="M390 80 C430 80 420 150 460 150"
        fill="none"
        stroke="var(--signal)"
        strokeWidth={2}
        strokeDasharray="5 5"
        opacity={merged ? 1 : 0}
        className="transition-opacity duration-500"
      />
      {[40, 100, 220, 340].map((x) => (
        <circle
          key={x}
          cx={x}
          cy={150}
          r={6}
          className="fill-background stroke-muted-foreground/50"
          strokeWidth={2}
        />
      ))}
      {commits.map((x, i) => (
        <circle
          key={x}
          cx={x}
          cy={80}
          r={6}
          strokeWidth={2}
          className={`transition-opacity duration-300 ${i < step ? "opacity-100" : "opacity-0"}`}
          fill="var(--background)"
          stroke="var(--signal)"
        />
      ))}
      <circle
        cx={460}
        cy={150}
        r={merged ? 9 : 6}
        fill={merged ? "var(--signal)" : "var(--background)"}
        className="stroke-muted-foreground/50 transition-all duration-500"
        strokeWidth={2}
      />
      {merged && <circle cx={460} cy={150} r={18} fill="var(--signal)" opacity={0.15} />}
      <text x={40} y={182} className="fill-muted-foreground font-mono text-[11px]">
        main
      </text>
      <text x={190} y={60} className="fill-signal font-mono text-[11px]">
        agent-49
      </text>
      <text
        x={440}
        y={182}
        className={`font-mono text-[11px] ${merged ? "fill-signal" : "fill-muted-foreground"}`}
      >
        {merged ? "merged" : "…"}
      </text>
    </svg>
  );
}

const BRANCH_ROWS = ["main", "agent-3", "agent-7"];

function ProtectMini() {
  const n = useTick(2600);
  const denied = n % 2 === 1;
  return (
    <div className="grid w-80 max-w-[calc(100%-3rem)] gap-2">
      {BRANCH_ROWS.map((b, i) => (
        <div
          key={b}
          className={`flex h-10 items-center gap-3 px-3 font-mono text-[12px] ${i === 0 ? `rounded-xl ${LIT}` : PANEL}`}
        >
          {i === 0 ? (
            <Lock className="size-3.5" strokeWidth={2} />
          ) : (
            <GitBranch className="size-3.5 text-muted-foreground" strokeWidth={1.5} />
          )}
          <span className={i === 0 ? "text-signal" : "text-foreground"}>{b}</span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {i === 0 ? "protected" : "writable"}
          </span>
        </div>
      ))}
      <p
        key={n}
        className={`rise-in mt-1 font-mono text-[11px] ${denied ? "text-foreground" : "text-muted-foreground"}`}
      >
        {denied ? "✕ write main/report.md · use a merge" : "✓ write agent-3/report.md"}
      </p>
    </div>
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
                className={`transition-colors duration-700 ${w === word ? "bg-signal/15 text-signal" : ""}`}
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

const ART: Record<MiniArtName, () => ReactNode> = {
  fork: ForkMini,
  mount: MountMini,
  autosave: AutosaveMini,
  recover: RecoverMini,
  diff: DiffMini,
  merge: MergeMini,
  protect: ProtectMini,
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
