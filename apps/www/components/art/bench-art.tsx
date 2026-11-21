"use client";

import { Check, Search, Server, Zap } from "lucide-react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";

import { useLoop } from "@/components/art/use-loop";
import { FolderIcon } from "@/components/ui/folder-icon";
import { cn } from "@/lib/utils";

const POP = { type: "spring", stiffness: 380, damping: 26 } as const;

const CRASH = [
  { text: "64 writers: append, fsync", tone: "text-foreground" },
  { text: "kill -9 skywaked", tone: "text-[#ef4444]" },
  { text: "mount again", tone: "text-foreground" },
  { text: "64 / 64 writes in the bucket", tone: "text-[#1f9d63] dark:text-[#5ee0a1]", done: true },
];

/** A terminal: synced writes, a hard kill, and every write still there afterwards. */
export function CrashProof() {
  const { ref, step } = useLoop<HTMLDivElement>(800, CRASH.length);
  const shown = step % (CRASH.length + 3);
  return (
    <div ref={ref} aria-hidden className="tile w-full p-4 font-mono text-xs leading-6">
      {CRASH.map((line, i) => (
        <motion.p
          key={line.text}
          animate={{ opacity: i < shown ? 1 : 0.15 }}
          className={cn("flex items-center gap-2", line.tone)}
        >
          {line.done ? (
            <Check className="size-3.5" />
          ) : i === 1 ? (
            <Zap className="size-3.5" />
          ) : (
            <span className="text-muted-foreground">$</span>
          )}
          {line.text}
        </motion.p>
      ))}
    </div>
  );
}

/** Two machines; the disk unmounts from one and mounts on the other. */
export function MoveDisk() {
  const { ref, step } = useLoop<HTMLDivElement>(1500, 0);
  const there = step % 2 === 1;
  return (
    <div ref={ref} aria-hidden className="grid w-full grid-cols-2 gap-3">
      {[0, 1].map((node) => {
        const here = there === (node === 1);
        return (
          <div key={node} className="tile flex h-28 flex-col justify-between p-3">
            <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <Server className="size-3.5" /> node {node + 1}
              <span
                className={cn(
                  "ml-auto size-2 rounded-full transition-colors duration-300",
                  here ? "bg-[#3dd68c]" : "bg-foreground/15",
                )}
              />
            </span>
            <AnimatePresence>
              {here && (
                <motion.span
                  initial={{ opacity: 0, x: node ? -24 : 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: node ? -24 : 24 }}
                  transition={POP}
                  className="flex items-center gap-2 font-mono text-xs text-foreground"
                >
                  <FolderIcon className="w-6" /> /mnt/skywake
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/** A file is saved, and a moment later a search finds it. */
export function FreshSearch() {
  const { ref, step, still } = useLoop<HTMLDivElement>(900, 2);
  const phase = still ? 2 : step % 4;
  return (
    <div ref={ref} aria-hidden className="grid w-full gap-2 font-mono text-xs">
      <div className="tile flex h-10 items-center gap-2 px-3">
        <span className="text-muted-foreground">$</span>
        <span className="text-foreground">{`echo "30-day refunds" > faq.md`}</span>
      </div>
      <div className="tile flex h-10 items-center gap-2 px-3 text-muted-foreground">
        <Search className="size-3.5" /> refund window
      </div>
      <div className="h-10">
        <AnimatePresence>
          {phase >= 1 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={POP}
              className="sheet flex h-10 items-center gap-2 px-3"
            >
              <span className="size-2 rounded-full bg-[#8b5cf6]" /> faq.md
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const SEGMENTS = 48;

/** A bar of small segments that fill when it comes into view. */
export function Segments({ share, lit }: { share: number; lit?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.8 });
  const still = useReducedMotion() ?? false;
  const filled = Math.max(1, Math.round(share * SEGMENTS));
  return (
    <div ref={ref} aria-hidden className="flex h-6 gap-[3px]">
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span
          key={i}
          className={cn(
            "flex-1 rounded-[2px] transition-colors",
            i < filled && (seen || still)
              ? lit
                ? "bg-(--sun)"
                : "bg-muted-foreground/50"
              : "bg-foreground/[0.06]",
          )}
          style={{ transitionDelay: still ? "0ms" : `${i * 18}ms` }}
        />
      ))}
    </div>
  );
}
