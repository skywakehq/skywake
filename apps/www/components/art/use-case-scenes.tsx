"use client";

import { Check, Search, Star } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { useLoop } from "@/components/art/use-loop";
import { AGENTS, AgentLogo } from "@/components/ui/agent-logos";
import { FolderIcon } from "@/components/ui/folder-icon";

const POP = { type: "spring", stiffness: 380, damping: 22 } as const;

function Mark({ text }: { text: string }) {
  return (
    <>
      {text.split(/\[([^\]]+)\]/).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-[0.3em] bg-(--sun)/60 px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

const QUESTION = "refund annual plan";
const HITS = [
  { path: "billing/refunds.md", line: "[Annual plans] are [refunded] in 30 days." },
  { path: "billing/changes.md", line: "Upgrade any time. [Annual plans] prorate." },
];

/** An agent asks the disk a question and the matching docs pop up. */
function Knowledge() {
  const { ref, step, still } = useLoop<HTMLDivElement>(90, QUESTION.length + 14);
  const at = step % (QUESTION.length + 30);
  const typed = Math.min(at, QUESTION.length);
  const found = still || at > QUESTION.length + 3;
  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-4">
      <div className="flex items-center gap-3">
        <AgentLogo agent={AGENTS[0]!} className="size-9" />
        <div className="tile flex h-11 flex-1 items-center gap-2 rounded-2xl px-4 text-sm">
          <Search className="size-4 text-muted-foreground" />
          {QUESTION.slice(0, still ? QUESTION.length : typed)}
          <span className="caret" />
        </div>
      </div>
      <ul className="grid gap-2.5 pl-12">
        <AnimatePresence>
          {found &&
            HITS.map((hit, i) => (
              <motion.li
                key={hit.path}
                initial={{ opacity: 0, y: 16, rotate: i ? 3 : -3, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, rotate: i ? 1 : -1, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ ...POP, delay: i * 0.12 }}
                className="sheet rounded-2xl px-4 py-3"
              >
                <p className="font-mono text-[11px] opacity-60">{hit.path}</p>
                <p className="mt-1 text-sm">
                  <Mark text={hit.line} />
                </p>
              </motion.li>
            ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

const NOTES = [
  { agent: 0, text: "Customer prefers yearly billing" },
  { agent: 1, text: "Last run stopped at step 4" },
  { agent: 3, text: "Use the staging bucket for tests" },
];

/** Three agents add what they learned to one notes file. */
function Memory() {
  const { ref, step } = useLoop<HTMLDivElement>(900, NOTES.length + 1);
  const shown = step % (NOTES.length + 3);
  return (
    <div ref={ref} className="grid h-full place-items-center">
      <div className="sheet w-full max-w-sm -rotate-1 rounded-2xl p-5">
        <p className="flex items-center gap-2 font-mono text-xs opacity-60">
          <FolderIcon className="w-4" /> memory/notes.md
        </p>
        <ul className="mt-4 grid gap-2.5 text-sm">
          {NOTES.map((note, i) => (
            <motion.li
              key={note.text}
              animate={i < shown ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
              transition={POP}
              className="flex items-center gap-2.5"
            >
              <AgentLogo agent={AGENTS[note.agent]!} className="size-5" />
              {note.text}
            </motion.li>
          ))}
        </ul>
        <div className="mt-5 flex items-center justify-end">
          {[0, 1, 2, 3].map((agent) => (
            <motion.span
              key={agent}
              animate={{ scale: shown > NOTES.length ? 1 : 0 }}
              transition={{ ...POP, delay: agent * 0.07 }}
              className="-ml-1.5"
            >
              <AgentLogo agent={AGENTS[agent]!} className="size-6 ring-2 ring-(--paper)" />
            </motion.span>
          ))}
        </div>
      </div>
    </div>
  );
}

const DROPS = [
  { agent: 0, file: "report.md", from: { x: -150, y: -60 } },
  { agent: 1, file: "data.csv", from: { x: 150, y: -60 } },
  { agent: 3, file: "chart.png", from: { x: 0, y: -120 } },
];

/** Agents drop files into one shared folder. */
function Storage() {
  const { ref, step, still } = useLoop<HTMLDivElement>(1000, 0);
  const drop = DROPS[step % DROPS.length]!;
  return (
    <div ref={ref} className="relative grid h-full place-items-center">
      {DROPS.map((d) => (
        <span
          key={d.agent}
          className="absolute top-1/2 left-1/2"
          style={{ translate: `calc(${d.from.x}px - 50%) calc(${d.from.y + 40}px - 50%)` }}
        >
          <motion.span
            className="block"
            animate={!still && d === drop ? { y: [0, -8, 0] } : { y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <AgentLogo agent={AGENTS[d.agent]!} className="size-12 ring-2 ring-foreground/15" />
          </motion.span>
        </span>
      ))}
      <motion.div
        key={step}
        animate={{ scaleX: [1, 1.06, 1], scaleY: [1, 0.94, 1] }}
        transition={{ delay: 0.55, duration: 0.35 }}
        className="relative translate-y-10 origin-bottom"
      >
        <FolderIcon className="w-44 drop-shadow-[0_14px_18px_rgb(0_0_0/0.3)]" />
      </motion.div>
      {!still && (
        <motion.span
          key={`f${step}`}
          initial={{ x: drop.from.x, y: drop.from.y + 40, opacity: 0, scale: 0.7 }}
          animate={{ x: 0, y: 40, opacity: [0, 1, 1, 0], scale: [0.7, 1, 0.6] }}
          transition={{ duration: 0.65, ease: "easeIn" }}
          className="sheet absolute rounded-lg px-2 py-1 font-mono text-[11px]"
        >
          {drop.file}
        </motion.span>
      )}
    </div>
  );
}

const LANES = [
  { agent: 0, y: 30, color: "#d97757" },
  { agent: 1, y: 80, color: "#5fb3f6" },
  { agent: 2, y: 130, color: "#a78bfa" },
];
const WINNER = 1;

/** Three agents try the same fix on their own branches; the best one merges. */
function Coding() {
  const { ref, step } = useLoop<HTMLDivElement>(600, 7);
  const phase = step % 10;
  const merged = phase >= 6;
  const grown = Math.min(phase, 4);
  return (
    <div ref={ref} className="relative h-full">
      <svg viewBox="0 0 400 200" className="size-full overflow-visible">
        <line
          x1="10"
          y1="175"
          x2="390"
          y2="175"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {LANES.map((lane, i) => {
          const tip = 120 + grown * 45;
          const win = i === WINNER;
          return (
            <motion.g
              key={lane.agent}
              animate={{ opacity: merged && !win ? 0.25 : 1 }}
              transition={{ duration: 0.4 }}
            >
              <motion.path
                d={`M40 175 C80 175 70 ${lane.y} 110 ${lane.y} L${tip} ${lane.y}`}
                fill="none"
                stroke={lane.color}
                strokeWidth="3"
                strokeLinecap="round"
                animate={{ d: `M40 175 C80 175 70 ${lane.y} 110 ${lane.y} L${tip} ${lane.y}` }}
                transition={POP}
              />
              {win && (
                <motion.path
                  d={`M300 ${lane.y} C340 ${lane.y} 330 175 360 175`}
                  fill="none"
                  stroke={lane.color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  animate={{ pathLength: merged ? 1 : 0 }}
                  transition={{ duration: 0.45 }}
                />
              )}
            </motion.g>
          );
        })}
        <circle
          cx="40"
          cy="175"
          r="7"
          fill="var(--background)"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="3"
        />
        <motion.circle
          cx="360"
          cy="175"
          r="11"
          animate={{ scale: merged ? 1 : 0 }}
          transition={POP}
          fill="#3dd68c"
        />
      </svg>
      {LANES.map((lane, i) => (
        <motion.span
          key={lane.agent}
          className="absolute"
          style={{ top: `${(lane.y / 200) * 100}%` }}
          animate={{
            left: `${((120 + grown * 45) / 400) * 100}%`,
            opacity: merged && i !== WINNER ? 0.25 : 1,
          }}
          transition={POP}
        >
          <AgentLogo
            agent={AGENTS[lane.agent]!}
            className="size-8 -translate-1/2 ring-2 ring-foreground/15"
          />
        </motion.span>
      ))}
      <AnimatePresence>
        {merged && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={POP}
            className="absolute grid size-6 -translate-1/2 place-items-center text-white"
            style={{ left: "90%", top: "87.5%" }}
          >
            <Check className="size-4" />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

const RUNS = [0.62, 0.48, 0.9, 0.7];
const BEST = 2;

/** One saved environment fans out into RL rollouts; the highest reward gets a star. */
function Evals() {
  const { ref, step, still } = useLoop<HTMLDivElement>(700, 5);
  const phase = still ? 5 : step % 9;
  return (
    <div ref={ref} className="flex h-full items-center gap-4">
      <div className="flex shrink-0 flex-col items-center gap-2">
        <FolderIcon className="w-20 -rotate-6 drop-shadow-[0_12px_16px_rgb(0_0_0/0.25)]" />
        <span className="font-mono text-[11px] text-muted-foreground">c76ff44</span>
      </div>
      <svg viewBox="0 0 40 200" preserveAspectRatio="none" className="h-48 w-10 shrink-0">
        {RUNS.map((_, i) => (
          <path
            key={i}
            d={`M0 100 C20 100 20 ${25 + i * 50} 40 ${25 + i * 50}`}
            fill="none"
            stroke="var(--sun)"
            strokeWidth="2"
            strokeDasharray="0.1 6"
            strokeLinecap="round"
            className="wire"
          />
        ))}
      </svg>
      <ul className="grid flex-1 gap-2">
        {RUNS.map((score, i) => (
          <li key={i} className="tile flex h-11 items-center gap-3 rounded-xl px-3">
            <span className="w-20 shrink-0 font-mono text-[11px] whitespace-nowrap text-muted-foreground">
              rollout {i + 1}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-(--soft)">
              <motion.span
                className="block h-full rounded-full"
                style={{ background: i === BEST ? "var(--sun)" : "var(--muted-foreground)" }}
                animate={{ width: phase >= 1 ? `${score * 100}%` : "0%" }}
                transition={{ duration: 1.2, delay: i * 0.1, ease: "easeOut" }}
              />
            </span>
            <motion.span
              animate={{ scale: i === BEST && phase >= 4 ? 1 : 0, rotate: phase >= 4 ? 0 : -90 }}
              transition={POP}
            >
              <Star className="size-4 fill-(--sun) text-(--sun)" />
            </motion.span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SCENES = [Knowledge, Memory, Storage, Coding, Evals];

/** The animated scene for one use case, by its place in useCases.items. */
export function UseCaseScene({ index }: { index: number }) {
  const Scene = SCENES[index] ?? Knowledge;
  return <Scene />;
}
