"use client";

import { useReducedMotion } from "motion/react";
import Image from "next/image";

const ANIMATED = "https://fonts.gstatic.com/s/e/notoemoji/latest/1f525/512.webp";

/** The fire emoji, animated, sized by the text around it. */
export function Fire({ className }: { className?: string }) {
  const still = useReducedMotion() ?? false;
  if (still)
    return (
      <span aria-hidden className={className}>
        🔥
      </span>
    );
  return (
    <Image
      unoptimized
      src={ANIMATED}
      alt=""
      aria-hidden
      width={512}
      height={512}
      className={`inline-block size-[1em] -translate-y-[0.08em] align-middle ${className ?? ""}`}
    />
  );
}
