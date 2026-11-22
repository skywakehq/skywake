"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/** Counts up while its element is on screen and `run` is on, and starts over from 0 when `run` goes off. With reduced motion it stays at `rest`. */
export function useLoop<T extends HTMLElement>(ms: number, rest: number, run = true) {
  const ref = useRef<T>(null);
  const seen = useInView(ref, { amount: 0.35 });
  const still = useReducedMotion() ?? false;
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!run) setStep(0);
  }, [run]);

  useEffect(() => {
    if (still || !seen || !run) return;
    const timer = setInterval(() => setStep((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [still, seen, ms, run]);

  return { ref, step: still ? rest : step, still };
}
