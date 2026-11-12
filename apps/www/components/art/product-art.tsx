"use client";

import {
  Database,
  FileCode,
  FileJson,
  FileText,
  Image as ImageIcon,
  Sheet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const FADE = {
  maskImage:
    "linear-gradient(to right, transparent, black 10%, black 90%, transparent), linear-gradient(to bottom, black 70%, transparent)",
  maskComposite: "intersect",
} as const;

const ICONS: LucideIcon[] = [FileText, FileCode, Sheet, ImageIcon, FileJson, Database];
const COLS = 7;
const ROWS = 3;
const TILES = COLS * ROWS;

function edits(n: number) {
  const a = (n * 7 + 3) % TILES;
  const b = (n * 11 + 9) % TILES;
  return a === b ? [a] : [a, b];
}

export function ForkArt() {
  const [n, setN] = useState(12);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setN((v) => v + 1), 2600);
    return () => clearInterval(t);
  }, []);

  const edited = edits(n);
  return (
    <div aria-hidden className="relative -mx-6 sm:-mx-8">
      <div className="absolute top-0 left-6 z-10 sm:left-8">
        <p
          key={n}
          className="rise-in inline-flex h-8 items-center gap-2 rounded-md bg-background px-3.5 font-mono text-[12px] text-foreground ring-1 ring-border"
        >
          <span className="size-1.5 rounded-full bg-signal" />
          agent-{n}
          <span className="text-muted-foreground">forked in 10 ms</span>
        </p>
      </div>
      <div
        className="grid gap-2.5 px-2 pt-14"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, ...FADE }}
      >
        {Array.from({ length: TILES }, (_, i) => {
          const Icon = ICONS[(i * 5) % ICONS.length]!;
          const lit = edited.includes(i);
          return (
            <div
              key={i}
              className={`relative grid aspect-[5/4] place-items-center rounded-xl ring-1 transition-all duration-700 ${
                lit
                  ? "bg-[color-mix(in_oklab,var(--signal)_14%,var(--background))] ring-signal/60"
                  : "bg-background ring-border"
              }`}
            >
              <Icon
                strokeWidth={1.5}
                className={`size-5 transition-colors duration-700 ${
                  lit ? "text-signal" : "text-muted-foreground/50"
                }`}
              />
              {lit && (
                <span className="rise-in absolute top-1.5 right-1.5 rounded-full bg-signal px-1.5 font-mono text-[9px] leading-4 text-background">
                  M
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const QUERIES: { q: string; hits: [string, string][] }[] = [
  {
    q: "refunds on annual plans",
    hits: [
      ["billing.md", "0.92"],
      ["terms.md", "0.81"],
      ["faq.md", "0.74"],
    ],
  },
  {
    q: "reset a lost password",
    hits: [
      ["auth.md", "0.94"],
      ["support.md", "0.83"],
      ["login.ts", "0.77"],
    ],
  },
  {
    q: "invoices for teams",
    hits: [
      ["billing.md", "0.89"],
      ["teams.md", "0.85"],
      ["pricing.md", "0.80"],
    ],
  },
];

const COUNT = 420;
const POINTS = Array.from({ length: COUNT }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / COUNT;
  const r = Math.sqrt(1 - y * y);
  const a = i * 2.39996;
  return [Math.cos(a) * r, y, Math.sin(a) * r] as const;
});
const TARGETS = [
  [0.35, 0.3, 0.88],
  [-0.4, -0.25, 0.88],
  [0.1, -0.5, 0.86],
] as const;

function nearest(t: readonly number[], turn: number) {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const x = t[0]! * c - t[2]! * s;
  const z = t[0]! * s + t[2]! * c;
  return new Set(
    POINTS.map((p, i) => [p[0] * x + p[1] * t[1]! + p[2] * z, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 7)
      .map(([, i]) => i),
  );
}

export function SearchArt() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [k, setK] = useState(0);
  const query = useRef(0);
  useEffect(() => {
    query.current = k;
  }, [k]);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setK((v) => (v + 1) % QUERIES.length), 3600);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let since = performance.now();
    let last = -1;
    let lit = new Set<number>();

    function draw(now: number) {
      const dpr = devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== w * dpr) el.width = w * dpr;
      if (el.height !== h * dpr) el.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const style = getComputedStyle(el);
      const ink = style.color;
      const signal = style.getPropertyValue("--signal").trim() || "#2f5bea";

      const turn = still ? 0.6 : now / 9000;
      if (query.current !== last) {
        last = query.current;
        since = now;
        lit = nearest(TARGETS[last]!, turn);
      }
      const glow = Math.min(1, (now - since) / 700);

      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const R = Math.min(w * 0.36, h * 0.62);
      const cx = w * 0.62;
      const cy = h * 0.62;

      const litXY: [number, number][] = [];
      POINTS.forEach(([x, y, z], i) => {
        const rx = x * cos + z * sin;
        const rz = -x * sin + z * cos;
        const depth = (rz + 1) / 2;
        const px = cx + rx * R;
        const py = cy + y * R;
        if (lit.has(i)) {
          litXY.push([px, py]);
          return;
        }
        ctx.globalAlpha = 0.08 + depth * 0.45;
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(px, py, 0.6 + depth * 1.1, 0, Math.PI * 2);
        ctx.fill();
      });

      const [best] = litXY;
      ctx.strokeStyle = signal;
      ctx.fillStyle = signal;
      ctx.lineWidth = 1;
      litXY.forEach(([px, py], i) => {
        if (best && i > 0) {
          ctx.globalAlpha = 0.45 * glow;
          ctx.beginPath();
          ctx.moveTo(best[0], best[1]);
          ctx.lineTo(px, py);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.16 * glow;
        ctx.beginPath();
        ctx.arc(px, py, i === 0 ? 10 + Math.sin(now / 400) * 2 : 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = glow;
        ctx.beginPath();
        ctx.arc(px, py, i === 0 ? 3.5 : 2.6, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      if (!still) frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  const { q, hits } = QUERIES[k]!;
  return (
    <div aria-hidden className="relative -mx-6 h-64 sm:-mx-8" style={FADE}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full text-muted-foreground" />
      <div className="absolute top-0 left-6 flex flex-col gap-2 sm:left-8">
        <p
          key={q}
          className="rise-in inline-flex h-8 w-fit items-center gap-2 rounded-md bg-background px-3.5 font-mono text-[12px] text-foreground ring-1 ring-border"
        >
          <span className="size-1.5 rounded-full bg-signal" />
          {q}
          <span className="text-muted-foreground">411 ms</span>
        </p>
        <ol key={`${q}-hits`} className="mt-1 grid gap-1.5 pl-1">
          {hits.map(([file, score], i) => (
            <li
              key={file}
              className="rise-in flex items-center gap-2 font-mono text-[11px]"
              style={{ animationDelay: `${0.3 + i * 0.12}s` }}
            >
              <span className="text-signal">{i + 1}</span>
              <span className="text-foreground">{file}</span>
              <span className="text-muted-foreground">{score}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
