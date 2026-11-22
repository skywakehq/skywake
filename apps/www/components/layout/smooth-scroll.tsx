"use client";

import { ReactLenis, useLenis } from "lenis/react";
import { useReducedMotion } from "motion/react";
import { type ReactNode, useEffect } from "react";
import "lenis/dist/lenis.css";

/** Below about 50 frames a second, eased scrolling stutters worse than the browser's own. */
const SLOW_FRAME_MS = 20;

/** Fixed, so Lenis is made once: changing these props would tear it down mid-scroll. */
const OPTIONS = {
  lerp: 0.1,
  smoothWheel: true,
  allowNestedScroll: true,
  anchors: { offset: -72 },
  stopInertiaOnNavigate: true,
};

/**
 * Times a burst of frames and turns eased wheel scrolling off when the screen
 * draws slowly, as on a 30Hz display or a laptop in low power mode. It flips
 * the live instance's option instead of remaking it, so a scroll in progress
 * never stops. Waits for the page to settle first, since frames during
 * hydration are always slow, and checks again whenever the tab comes back.
 */
function FrameRateGuard() {
  const lenis = useLenis();
  useEffect(() => {
    if (!lenis) return;
    let id = 0;
    let idle = 0;
    const measure = () => {
      cancelAnimationFrame(id);
      if (document.hidden) return;
      const gaps: number[] = [];
      let last = 0;
      const tick = (now: number) => {
        if (last) gaps.push(now - last);
        last = now;
        if (gaps.length < 30) {
          id = requestAnimationFrame(tick);
          return;
        }
        gaps.sort((a, b) => a - b);
        lenis.options.smoothWheel = gaps[gaps.length >> 1]! <= SLOW_FRAME_MS;
      };
      id = requestAnimationFrame(tick);
    };
    const later = () => {
      idle =
        typeof requestIdleCallback === "function"
          ? requestIdleCallback(measure, { timeout: 2000 })
          : (setTimeout(measure, 1000) as unknown as number);
    };
    later();
    document.addEventListener("visibilitychange", measure);
    return () => {
      cancelAnimationFrame(id);
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(idle);
      clearTimeout(idle);
      document.removeEventListener("visibilitychange", measure);
    };
  }, [lenis]);
  return null;
}

/**
 * Eased wheel scrolling for the whole page. Touch keeps the phone's own
 * scrolling, inner scroll areas still scroll, and anchor links land below the
 * fixed header. People who ask for less motion get the browser's own scrolling.
 */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const still = useReducedMotion() ?? false;
  if (still) return children;
  return (
    <ReactLenis root options={OPTIONS}>
      <FrameRateGuard />
      {children}
    </ReactLenis>
  );
}
