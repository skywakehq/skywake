"use client";

import { Check, Search, Server, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { siGit, siNpm } from "simple-icons";

import { usePlayLoop } from "@/components/art/play";
import { AGENTS, AgentLogo } from "@/components/ui/agent-logos";
import { Badge, Brand } from "@/components/ui/badge";
import { FolderIcon } from "@/components/ui/folder-icon";
import { STORES } from "@/components/ui/stores";
import { cn } from "@/lib/utils";

const POP = { type: "spring", stiffness: 380, damping: 26 } as const;

const COMMANDS = [
  {
    tile: "#f05032",
    mark: <Brand path={siGit.path} />,
    run: "git status",
  },
  {
    tile: "#2b2b2b",
    mark: <Search className="size-4 text-white" />,
    run: 'grep -rl "TODO" src',
  },
  { tile: "#cb3837", mark: <Brand path={siNpm.path} />, run: "npm test" },
];

/** A terminal on the disk running everyday commands, one after another. */
export function ToolDemo() {
  const { ref, step, idle } = usePlayLoop<HTMLDivElement>(700, COMMANDS.length);
  const shown = idle ? COMMANDS.length : step % (COMMANDS.length + 2);
  return (
    <div ref={ref} aria-hidden className="flex w-full flex-col justify-center gap-4">
      {COMMANDS.map((command, i) => (
        <motion.div
          key={command.run}
          animate={{ opacity: i < shown ? 1 : 0.2 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-3 font-mono text-sm"
        >
          <Badge tile={command.tile}>{command.mark}</Badge>
          <span className="min-w-0 flex-1 truncate text-foreground">{command.run}</span>
          <Check className="size-4 shrink-0 text-[#3dd68c]" />
        </motion.div>
      ))}
    </div>
  );
}

function Machine({ name, dead, holds }: { name: string; dead: boolean; holds: boolean }) {
  return (
    <div
      className={cn(
        "tile flex h-20 flex-col justify-between p-3 transition-opacity duration-300",
        dead && "opacity-80",
      )}
    >
      <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <Server className="size-3.5" /> {name}
        <span
          className={cn(
            "ml-auto size-2 rounded-full transition-colors duration-300",
            dead ? "bg-[#ef4444]" : holds ? "bg-[#3dd68c]" : "bg-foreground/15",
          )}
        />
      </span>
      <div className="flex h-6 items-center font-mono text-xs">
        <AnimatePresence mode="popLayout" initial={false}>
          {dead ? (
            <motion.span
              key="dead"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-[#ef4444]"
            >
              <Zap className="size-3.5" /> kill -9
            </motion.span>
          ) : (
            holds && (
              <motion.span
                key="disk"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={POP}
                className="flex items-center gap-2 text-foreground"
              >
                <FolderIcon className="w-5" /> /mnt/skywake
              </motion.span>
            )
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** One machine is killed and the disk comes up on the other. Two measured numbers below. */
export function CrashSwap({ figures, labels }: { figures: string[]; labels: string[] }) {
  const { ref, step } = usePlayLoop<HTMLDivElement>(900, 2);
  const phase = step % 5;
  return (
    <div ref={ref} className="flex w-full flex-col justify-between gap-4">
      <div aria-hidden className="grid grid-cols-2 gap-3">
        <Machine name="node 1" dead={phase >= 1} holds={phase < 1} />
        <Machine name="node 2" dead={false} holds={phase >= 2} />
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {figures.map((figure, i) => (
          <div key={figure} className="flex flex-col-reverse gap-1">
            <dt className="text-sm text-muted-foreground">{labels[i]}</dt>
            <dd className="text-4xl leading-none font-medium tracking-[-0.04em] text-foreground tabular-nums">
              {figure}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const ASK = "money back on a yearly plan";
const HIT = {
  path: "billing/refunds.md",
  line: ["Annual plans", " can be ", "refunded", " within 30 days."],
};

/** A question in plain words finds a file that says it in other words. */
export function MeaningSearch() {
  const { ref, step, idle } = usePlayLoop<HTMLDivElement>(80, ASK.length + 20);
  const at = step % (ASK.length + 40);
  const typed = idle ? ASK.length : Math.min(at, ASK.length);
  const found = idle || at > ASK.length + 4;
  return (
    <div ref={ref} aria-hidden className="flex w-full flex-col justify-center gap-3">
      <div className="tile flex h-12 items-center gap-3 px-4 text-sm">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-foreground">
          {ASK.slice(0, typed)}
          {!idle && <span className="caret" />}
        </span>
      </div>
      <div className="h-24">
        <AnimatePresence>
          {found && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={POP}
              className="sheet px-5 py-4"
            >
              <p className="flex items-center gap-2 font-mono text-xs opacity-60">
                <AgentLogo agent={AGENTS[0]!} className="size-4" />
                {HIT.path}
              </p>
              <p className="mt-1.5 text-sm">
                {HIT.line.map((part, i) =>
                  i % 2 ? (
                    part
                  ) : (
                    <mark key={i} className="rounded-[0.3em] bg-[#8b5cf6]/30 px-0.5 text-inherit">
                      {part}
                    </mark>
                  ),
                )}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** An agent branches off main, adds commits and merges back. */
export function BranchMerge() {
  const { ref, step } = usePlayLoop<HTMLDivElement>(600, 5);
  const phase = step % 8;
  const merged = phase >= 5;
  const commits = Math.min(Math.max(phase - 1, 0), 3);
  return (
    <div ref={ref} aria-hidden className="relative w-full self-center">
      <svg viewBox="0 0 400 120" className="w-full overflow-visible">
        <line
          x1="20"
          y1="100"
          x2="380"
          y2="100"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <motion.path
          d="M60 100 C95 100 85 30 125 30 L275 30 C315 30 305 100 340 100"
          fill="none"
          stroke="#d97757"
          strokeWidth="3"
          strokeLinecap="round"
          animate={{ pathLength: merged ? 1 : phase >= 1 ? 0.62 : 0 }}
          transition={{ duration: 0.5 }}
        />
        {[160, 200, 240].map((x, i) => (
          <motion.circle
            key={x}
            cx={x}
            cy="30"
            fill="var(--background)"
            stroke="#d97757"
            strokeWidth="3"
            r="6"
            animate={{ scale: i < commits ? 1 : 0 }}
            transition={POP}
          />
        ))}
        <circle
          cx="60"
          cy="100"
          r="6"
          fill="var(--background)"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="3"
        />
        <motion.circle
          cx="340"
          cy="100"
          r="10"
          animate={{ scale: merged ? 1 : 0 }}
          transition={POP}
          fill="#3dd68c"
        />
      </svg>
      <span className="absolute top-0 left-[22%] -translate-y-1/2">
        <AgentLogo agent={AGENTS[0]!} className="size-7" />
      </span>
    </div>
  );
}

/** The object stores the disk runs on; one is lit at a time. */
export function BucketStores() {
  const { ref, step, idle } = usePlayLoop<HTMLUListElement>(700, 0);
  const active = idle ? -1 : step % STORES.length;
  return (
    <ul ref={ref} aria-hidden className="grid w-full grid-cols-2 content-center gap-1.5">
      {STORES.map((store, i) => (
        <li
          key={store.name}
          className={cn(
            "flex h-10 items-center gap-3 rounded-xl pr-3 pl-1.5 text-sm text-foreground transition-colors duration-300",
            i === active && "bg-background",
          )}
        >
          <Badge tile={store.tile}>{store.mark}</Badge>
          {store.name}
        </li>
      ))}
    </ul>
  );
}
