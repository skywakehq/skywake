"use client";

import { motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";

import { JourneyPaper, paperBox, useJourney } from "@/components/art/file-journey";
import { FolderBack, FolderFront } from "@/components/ui/folder-icon";
import { cn } from "@/lib/utils";

/** One folder, on its own. Scrolling opens it and lifts a file out, down to the agents below. */
export function FolderShot({ className }: { className?: string }) {
  const still = useReducedMotion() ?? false;
  const journey = useJourney();
  const rest = useMotionValue(0);
  const flap = useTransform(journey?.heroFlap ?? rest, [0, 1], [0, 40]);

  const folder = (
    <div data-journey-source className={cn("relative z-10 w-[min(19rem,62vw)]", className)}>
      <motion.div
        className="relative aspect-[100/82]"
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
          <FolderFront engraved className="size-full" />
        </motion.div>
      </motion.div>
    </div>
  );

  return folder;
}
