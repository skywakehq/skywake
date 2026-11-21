"use client";

import { Blend, Quote, Search, Sparkles } from "lucide-react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { AGENTS, AgentLogo } from "@/components/ui/agent-logos";
import { cn } from "@/lib/utils";

const TYPE_MS = 45;
const HOLD_MS = 3600;

const MODE_ICONS = [Sparkles, Quote, Blend];
const MODE_TINTS = ["#a78bfa", "#38bdf8", "var(--sun)"];

type Hit = { path: string; agent: number };

const RESULTS: { mode: number; hits: Hit[] }[] = [
  {
    mode: 0,
    hits: [
      { path: "docs/account-recovery.md", agent: 0 },
      { path: "support/faq.md", agent: 1 },
      { path: "runbooks/auth.md", agent: 3 },
    ],
  },
  {
    mode: 1,
    hits: [
      { path: "logs/api-0412.log", agent: 2 },
      { path: "src/net/retry.ts", agent: 1 },
      { path: "notes/bugs.md", agent: 4 },
    ],
  },
  {
    mode: 2,
    hits: [
      { path: "reports/q3-revenue.md", agent: 5 },
      { path: "notes/finance.md", agent: 0 },
      { path: "dashboards/sales.json", agent: 3 },
    ],
  },
];

const FILES = RESULTS.flatMap((result) => result.hits);

const PILE = [
  { left: 16, top: 8, rotate: -9 },
  { left: 84, top: 12, rotate: 7 },
  { left: 22, top: 40, rotate: 5 },
  { left: 80, top: 44, rotate: -6 },
  { left: 13, top: 72, rotate: -4 },
  { left: 87, top: 76, rotate: 9 },
  { left: 36, top: 86, rotate: 3 },
  { left: 64, top: 84, rotate: -8 },
  { left: 50, top: 2, rotate: 4 },
];

const RANKED = [14, 52, 68];

const SPRING = { type: "spring", stiffness: 210, damping: 24 } as const;

function Snippet({ text }: { text: string }) {
  return (
    <p className="mt-2 text-[15px] leading-relaxed">
      {text.split(/\[([^\]]+)\]/).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-[0.3em] bg-(--sun)/60 px-1 text-inherit">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </p>
  );
}

function ModeTag({ mode, label }: { mode: number; label: string }) {
  const Icon = MODE_ICONS[mode]!;
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="size-3.5" style={{ color: MODE_TINTS[mode] }} />
      {label}
    </span>
  );
}

function FileCard({
  hit,
  index,
  rank,
  dim,
  snippet,
  mode,
  modes,
}: {
  hit: Hit;
  index: number;
  rank: number;
  dim: boolean;
  snippet?: string;
  mode?: number;
  modes: string[];
}) {
  const pile = PILE[index]!;
  const ranked = rank >= 0;
  return (
    <motion.li
      className={cn(
        "sheet absolute origin-top rounded-2xl px-3.5 py-3 transition-[width] duration-500",
        ranked ? "w-[min(100%,34rem)]" : "w-[10.5rem] sm:w-[13.5rem]",
        ranked && "z-10",
        rank === 0 && "z-20",
      )}
      style={{ x: "-50%" }}
      initial={false}
      animate={{
        left: `${ranked ? 50 : pile.left}%`,
        top: `${ranked ? RANKED[rank] : pile.top}%`,
        rotate: ranked ? 0 : pile.rotate,
        scale: ranked ? 1 : 0.85,
        opacity: dim ? 0.4 : 1,
        filter: dim ? "blur(1.5px)" : "blur(0px)",
      }}
      transition={{ ...SPRING, delay: ranked ? rank * 0.08 : 0 }}
    >
      <p className="flex items-center gap-2.5 font-mono text-[13px]">
        <AgentLogo agent={AGENTS[hit.agent]!} className="size-5" />
        <span className="min-w-0 flex-1 truncate">{hit.path}</span>
        {ranked && (
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-(--paper-ink)/[0.08] font-sans text-xs">
            {rank + 1}
          </span>
        )}
      </p>
      <AnimatePresence initial={false}>
        {snippet && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transition: { delay: 0.25 } }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <Snippet text={snippet} />
            {mode !== undefined && (
              <p className="mt-2 text-xs opacity-70">
                <ModeTag mode={mode} label={modes[mode]!} />
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** A search box over a pile of the disk's files: the matches leap out of the pile into a ranked list. */
export function AskDisk({
  queries,
  modes,
  snippets,
}: {
  queries: string[];
  modes: string[];
  snippets: string[];
}) {
  const stage = useRef<HTMLDivElement>(null);
  const seen = useInView(stage, { amount: 0.35 });
  const still = useReducedMotion() ?? false;
  const [pick, setPick] = useState({ index: 0, auto: true });
  const [typed, setTyped] = useState(0);

  const query = queries[pick.index]!;
  const done = still || typed >= query.length;
  const { mode, hits } = RESULTS[pick.index]!;

  useEffect(() => {
    if (still || !seen) return;
    if (!done) {
      const timer = setTimeout(() => setTyped((n) => n + 1), TYPE_MS);
      return () => clearTimeout(timer);
    }
    if (!pick.auto) return;
    const timer = setTimeout(() => {
      setTyped(0);
      setPick((p) => ({ index: (p.index + 1) % RESULTS.length, auto: true }));
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [still, seen, done, typed, pick]);

  const choose = (index: number) => {
    setTyped(0);
    setPick({ index, auto: false });
  };

  return (
    <div ref={stage} className="mx-auto w-full max-w-5xl">
      <div className="tile relative z-30 mx-auto max-w-3xl rounded-[1.75rem] p-2.5">
        <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
          <Search className="size-5 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 truncate text-lg text-foreground sm:text-xl">
            {query.slice(0, still ? query.length : typed)}
            <span aria-hidden className="caret" />
          </p>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {queries.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => choose(i)}
                aria-pressed={i === pick.index}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-full px-3.5 text-sm transition-colors",
                  i === pick.index
                    ? "bg-foreground text-background"
                    : "bg-(--soft) text-muted-foreground hover:text-foreground",
                )}
              >
                <ModeTag mode={RESULTS[i]!.mode} label={modes[RESULTS[i]!.mode]!} />
                <span className="opacity-60">{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ul aria-hidden className="relative mt-6 h-[24rem] sm:h-[26rem]">
        {FILES.map((hit, i) => {
          const rank = done ? hits.indexOf(hit) : -1;
          return (
            <FileCard
              key={hit.path}
              hit={hit}
              index={i}
              rank={rank}
              dim={done && rank < 0}
              snippet={rank === 0 ? snippets[pick.index] : undefined}
              mode={rank === 0 ? mode : undefined}
              modes={modes}
            />
          );
        })}
      </ul>
    </div>
  );
}
