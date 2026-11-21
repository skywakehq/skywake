"use client";

import { motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";

import { JourneyPaper, paperBox, useJourney } from "@/components/art/file-journey";
import { AGENTS, AgentLogo } from "@/components/ui/agent-logos";
import { FolderBack, FolderFront } from "@/components/ui/folder-icon";

/** One folder, lit like a product shot. Scrolling opens it and lifts a file out. */
export function FolderShot({ worksWith }: { worksWith: string }) {
  const still = useReducedMotion() ?? false;
  const journey = useJourney();
  const rest = useMotionValue(0);
  const flap = useTransform(journey?.heroFlap ?? rest, [0, 1], [0, 40]);

  return (
    <div className="grid justify-items-center gap-14">
      <div data-journey-source className="relative w-[min(19rem,44vw)]">
        <div aria-hidden className="folder-spot" />
        <div aria-hidden className="folder-floor" />
        <motion.div
          className="relative z-10 aspect-[100/82] drop-shadow-[0_30px_40px_rgb(0_0_0/0.3)]"
          animate={still || journey ? undefined : { y: [0, -6, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        >
          <FolderBack className="absolute inset-0 size-full" />
          <motion.div
            aria-hidden
            className="absolute"
            style={{ ...paperBox, y: journey?.heroY, opacity: journey?.heroOpacity }}
          >
            <JourneyPaper />
          </motion.div>
          <motion.div
            className="absolute inset-0"
            style={{ rotateX: flap, originY: 0.93, transformPerspective: 700 }}
          >
            <FolderFront className="size-full" />
          </motion.div>
        </motion.div>
      </div>

      <div className="grid justify-items-center gap-4">
        <p className="t-small text-muted-foreground">{worksWith}</p>
        <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
          {AGENTS.map((agent) => (
            <li
              key={agent.name}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
            >
              <AgentLogo agent={agent} />
              {agent.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
