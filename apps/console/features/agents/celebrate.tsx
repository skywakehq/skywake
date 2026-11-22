"use client";

import { useEffect, useRef, useState } from "react";

const COLOURS = ["#ffc53d", "#f7b52c", "#3b82f6", "#e5322d", "#79b88a", "#d97757"];

/**
 * True for a moment after `level` goes up while this is on screen; not for
 * where it starts, nor while it is still unknown.
 */
export function useJustDone(level: number | boolean | undefined, ms = 1600) {
  const was = useRef<number>(undefined);
  const [just, setJust] = useState(false);
  useEffect(() => {
    if (level === undefined) return;
    const now = Number(level);
    const before = was.current;
    was.current = now;
    if (before === undefined || now <= before) return;
    setJust(true);
    const timer = setTimeout(() => setJust(false), ms);
    return () => clearTimeout(timer);
  }, [level, ms]);
  return just;
}

/** A burst of flat paper bits from the middle of its parent. */
export function Confetti({ count = 22 }: { count?: number }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-visible">
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.4;
        const reach = 70 + ((i * 37) % 60);
        return (
          <span
            key={i}
            className="absolute top-1/2 left-1/2 rounded-[2px] opacity-0 animate-[burst_1s_cubic-bezier(.15,.7,.3,1)_forwards]"
            style={
              {
                width: i % 4 === 0 ? 6 : 5,
                height: i % 4 === 0 ? 6 : 10,
                background: COLOURS[i % COLOURS.length],
                animationDelay: `${(i % 5) * 25}ms`,
                "--x": `${Math.cos(angle) * reach}px`,
                "--y": `${Math.sin(angle) * reach * 0.7 + 30}px`,
                "--r": `${((i * 97) % 540) - 270}deg`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </span>
  );
}
