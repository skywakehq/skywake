"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";

// The landing page's hero grid: 72px cells, each a faint square inset by 4px.
const CELL = 72;
const GAP = 4;

function tile(line: string, opacity: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}"><rect x="${GAP + 0.5}" y="${GAP + 0.5}" width="${CELL - 2 * GAP - 1}" height="${CELL - 2 * GAP - 1}" fill="none" stroke="${line}" stroke-opacity="${opacity}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const hatch = {
  backgroundImage:
    "repeating-linear-gradient(135deg, color-mix(in oklab, var(--foreground) 22%, transparent) 0 1px, transparent 1px 6px)",
};

// A few cells drawn in slanted lines, like a small tree of files.
const HATCHED = [
  [4, 1],
  [5, 1],
  [5, 2],
  [6, 2],
  [5, 3],
];
// Where the accent crosses sit, on grid corners.
const CROSSES = [
  [4, 1],
  [7, 4],
  [2, 6],
];

function cell(col: number, row: number): CSSProperties {
  return {
    left: col * CELL + GAP,
    top: row * CELL + GAP,
    width: CELL - 2 * GAP,
    height: CELL - 2 * GAP,
  };
}

type Kind = "fill" | "accent" | "hatch";
type Pulse = { id: number; col: number; row: number; kind: Kind; trail?: boolean };

const LOOK: Record<Kind, string> = {
  fill: "bg-foreground/[0.07]",
  accent: "bg-signal/[0.16]",
  hatch: "",
};

// Mostly soft fills, some in slanted lines, now and then the accent.
function pick(): Kind {
  const roll = Math.random();
  return roll < 0.18 ? "accent" : roll < 0.4 ? "hatch" : "fill";
}

let nextId = 0;

/** The grid behind the sign-in panel: brighter under the cursor, and now and
 * then a cell fills in and fades, like a file being written. */
export function AuthGrid() {
  const box = useRef<HTMLDivElement>(null);
  const [pulses, setPulses] = useState<Pulse[]>([]);

  useEffect(() => {
    const el = box.current?.parentElement;
    if (!el) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let last = "";
    const move = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      box.current!.style.setProperty("--x", `${x}px`);
      box.current!.style.setProperty("--y", `${y}px`);
      box.current!.style.setProperty("--spot", "1");
      // The cell under the cursor lights up as it passes, leaving a short trail.
      const col = Math.floor(x / CELL);
      const row = Math.floor(y / CELL);
      if (still || `${col},${row}` === last) return;
      last = `${col},${row}`;
      const kind = Math.random() < 0.2 ? "accent" : "fill";
      setPulses((now) => [...now.slice(-24), { id: ++nextId, col, row, kind, trail: true }]);
    };
    const leave = () => box.current!.style.setProperty("--spot", "0");
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, []);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      const el = box.current;
      if (!el) return;
      const cols = Math.floor(el.clientWidth / CELL);
      // Only the upper part, where nothing is written over the grid.
      const rows = Math.max(1, Math.floor((el.clientHeight * 0.62) / CELL));
      const next = {
        id: ++nextId,
        col: Math.floor(Math.random() * cols),
        row: Math.floor(Math.random() * rows),
        kind: pick(),
      };
      setPulses((now) => [...now.slice(-24), next]);
    }, 450);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      ref={box}
      aria-hidden
      className="pointer-events-none absolute inset-0 [--spot:0] [mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
    >
      <div
        className="absolute inset-0 dark:hidden"
        style={{ backgroundImage: tile("#161614", 0.08) }}
      />
      <div
        className="absolute inset-0 hidden dark:block"
        style={{ backgroundImage: tile("#ededed", 0.08) }}
      />
      {/* The same grid, stronger, seen only around the cursor. */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: "var(--spot)",
          maskImage: "radial-gradient(circle 14rem at var(--x) var(--y), black, transparent)",
        }}
      >
        <div
          className="absolute inset-0 dark:hidden"
          style={{ backgroundImage: tile("#161614", 0.45) }}
        />
        <div
          className="absolute inset-0 hidden dark:block"
          style={{ backgroundImage: tile("#ededed", 0.4) }}
        />
      </div>
      {HATCHED.map(([col, row]) => (
        <div key={`${col}-${row}`} className="absolute" style={{ ...cell(col!, row!), ...hatch }} />
      ))}
      {pulses.map((pulse) => (
        <div
          key={pulse.id}
          className={`absolute opacity-0 ${LOOK[pulse.kind]} ${
            pulse.trail
              ? "animate-[cell-pulse_1.6s_ease-out_forwards]"
              : "animate-[cell-pulse_3.6s_ease-in-out_forwards]"
          }`}
          style={{ ...cell(pulse.col, pulse.row), ...(pulse.kind === "hatch" && hatch) }}
        />
      ))}
      {CROSSES.map(([col, row]) => (
        <span
          key={`${col}-${row}`}
          className="absolute size-[11px] -translate-x-1/2 -translate-y-1/2"
          style={{ left: col! * CELL, top: row! * CELL }}
        >
          <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-signal" />
          <span className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-signal" />
        </span>
      ))}
    </div>
  );
}
