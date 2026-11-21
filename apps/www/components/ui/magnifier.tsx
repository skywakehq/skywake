"use client";

import { motion, useReducedMotion } from "motion/react";

/** A yellow magnifying glass that sweeps back and forth, sized by the text around it. */
export function Magnifier({ className }: { className?: string }) {
  const still = useReducedMotion() ?? false;
  return (
    <motion.span
      aria-hidden
      className={`inline-block size-[0.9em] -translate-y-[0.05em] align-middle ${className ?? ""}`}
      animate={still ? undefined : { x: ["-0.08em", "0.12em", "-0.08em"], rotate: [-10, 8, -10] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
    >
      <svg viewBox="0 0 48 48" className="size-full overflow-visible">
        <path d="M30.5 30.5 42 42" stroke="#e59a12" strokeWidth="7" strokeLinecap="round" />
        <circle
          cx="20"
          cy="20"
          r="14"
          fill="#ffdf6e"
          fillOpacity="0.35"
          stroke="#f7b52c"
          strokeWidth="5"
        />
        <path
          d="M12.5 17a8 8 0 0 1 6-6"
          fill="none"
          stroke="#fff"
          strokeOpacity="0.85"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <motion.path
          d="M40 4l1.2 3.3L44.5 8.5l-3.3 1.2L40 13l-1.2-3.3L35.5 8.5l3.3-1.2z"
          fill="var(--sun)"
          animate={still ? undefined : { scale: [0, 1, 0], opacity: [0, 1, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
          style={{ transformOrigin: "40px 8.5px" }}
        />
      </svg>
    </motion.span>
  );
}
