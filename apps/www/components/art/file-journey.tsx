"use client";

import {
  type MotionValue,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from "motion/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export const JOURNEY_FILE = "launch-deck.pdf";
const JOURNEY_SIZE = "200 MB";
export const PAPER = { left: 0.1, top: 0.12, width: 0.8, height: 0.7 };
export const PAPER_RISE = 0.85;
export const DROP_PX = 180;

const OPEN: [number, number] = [0, 40];
const OUT = 100;
const CLOSE: [number, number] = [120, 180];
const SETTLE = 100;

type Box = { x: number; y: number; w: number; h: number };
type Geo = {
  from: Box;
  to: Box;
  rest: number;
  slot: number;
  land: number;
  done: number;
  arc: number;
};

type Journey = {
  heroFlap: MotionValue<number>;
  heroY: MotionValue<number>;
  heroOpacity: MotionValue<number>;
  diskFlap: MotionValue<number>;
  diskY: MotionValue<number>;
  diskOpacity: MotionValue<number>;
  landed: boolean;
};

const JourneyContext = createContext<Journey | null>(null);

/** The scroll state of the file's trip, or null when the trip is off. */
export function useJourney() {
  return useContext(JourneyContext);
}

/** Where the file sits inside a folder, as fractions of the folder's box. */
export const paperBox = {
  left: `${PAPER.left * 100}%`,
  top: `${PAPER.top * 100}%`,
  width: `${PAPER.width * 100}%`,
  height: `${PAPER.height * 100}%`,
};

const BARS = [38, 62, 48, 84];

/** The file being carried: a big slide deck with a preview of its first slide. It scales with its box. */
export function JourneyPaper() {
  return (
    <div className="size-full [container-type:inline-size]">
      <div className="sheet flex size-full flex-col gap-[3.3cqw] overflow-hidden rounded-[5cqw] p-[5cqw] text-left">
        <div className="flex items-center gap-[2.5cqw] text-[4.5cqw] leading-none">
          <span className="rounded-[1.6cqw] bg-[#e5322d] px-[1.6cqw] py-[1cqw] text-[3.7cqw] font-bold text-white">
            PDF
          </span>
          <span className="min-w-0 flex-1 truncate font-mono">{JOURNEY_FILE}</span>
          <span className="shrink-0 font-mono opacity-50">{JOURNEY_SIZE}</span>
        </div>
        <div className="flex flex-1 flex-col justify-between rounded-[3.3cqw] bg-[#1d1b18] p-[4cqw] text-white">
          <p className="text-[5.4cqw] leading-tight font-semibold">Q3 launch</p>
          <div className="flex h-[45%] items-end gap-[2.5cqw]">
            {BARS.map((height, i) => (
              <span
                key={height}
                className={
                  i === BARS.length - 1
                    ? "flex-1 rounded-[0.8cqw] bg-(--sun)"
                    : "flex-1 rounded-[0.8cqw] bg-white/25"
                }
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-[2.5cqw]">
          {BARS.map((height) => (
            <span key={height} className="aspect-[16/10] rounded-[1.6cqw] bg-current opacity-10" />
          ))}
        </div>
      </div>
    </div>
  );
}

const span = (y: number, [a, b]: [number, number]) => Math.min(1, Math.max(0, (y - a) / (b - a)));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);
/** Eases out only: already moving at the start, so it picks up the climb's speed. */
const glide = (t: number) => t * (0.6 + t * (1.8 - 1.4 * t));

function hermite(at: number, a: number, b: number, y0: number, y1: number, m0: number, m1: number) {
  const h = b - a;
  const t = (at - a) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * h * m0 +
    (3 * t2 - 2 * t3) * y1 +
    (t3 - t2) * h * m1
  );
}

function height(g: Geo, at: number) {
  const drop = (g.slot - g.to.y) / (g.done - g.land);
  const travel = (g.to.y - g.from.y) / (g.land - OUT);
  const arrive = (travel + drop) / 2;
  // The climb and the flight are shaped on screen (page position minus scroll),
  // which is what the eye follows. The climb tops out level as the file leaves
  // the folder, while it is already moving sideways, then the flight falls
  // smoothly into the disk. No point where it hangs, and the peak stays in view.
  if (at <= OUT) return hermite(Math.max(at, 0), 0, OUT, g.rest, g.from.y - OUT, -1, 0) + at;
  if (at <= g.land)
    return hermite(at, OUT, g.land, g.from.y - OUT, g.to.y - g.land, 0, arrive - 1) + at;
  return hermite(Math.min(at, g.done), g.land, g.done, g.to.y, g.slot, arrive, 0);
}

function measure(root: HTMLElement): Geo | null {
  const source = root.querySelector("[data-journey-source]");
  const target = root.querySelector("[data-journey-target]");
  if (!source || !target) return null;
  const box = root.getBoundingClientRect();
  const s = source.getBoundingClientRect();
  const d = target.getBoundingClientRect();
  const center = PAPER.top + PAPER.height / 2;
  const rest = s.top - box.top + s.height * center;
  const from = {
    x: s.left - box.left + s.width / 2,
    y: rest - s.height * PAPER.height * PAPER_RISE,
    w: s.width * PAPER.width,
    h: s.height * PAPER.height,
  };
  const to = {
    x: d.left - box.left + d.width / 2,
    y: d.top - box.top + d.height * center - DROP_PX,
    w: d.width * PAPER.width,
    h: d.height * PAPER.height,
  };
  const land = Math.max(OUT + 300, box.top + window.scrollY + to.y - window.innerHeight * 0.5);
  return {
    from,
    to,
    rest,
    slot: to.y + DROP_PX,
    land,
    done: land + SETTLE,
    arc: Math.min(140, box.width * 0.1),
  };
}

/** Carries one file out of the hero folder and down the page into the shared disk as you scroll. */
export function FileJourney({ children }: { children: ReactNode }) {
  const still = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const geo = useRef<Geo | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [landed, setLanded] = useState(false);
  const { scrollY } = useScroll();

  const heroFlap = useMotionValue(0);
  const heroY = useMotionValue(0);
  const heroOpacity = useMotionValue(1);
  const diskFlap = useMotionValue(0);
  const diskY = useMotionValue(-DROP_PX);
  const diskOpacity = useMotionValue(0);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useMotionValue(0);
  const scale = useMotionValue(1);
  const opacity = useMotionValue(0);

  const apply = useCallback(
    (at: number) => {
      heroFlap.set(at < CLOSE[0] ? span(at, OPEN) : 1 - span(at, CLOSE));
      const g = geo.current;
      if (!g) return;
      const now = height(g, at);
      const t = span(at, [OUT, g.land]);
      // Already swinging as it leaves the folder, so the level top of the climb never reads as a pause.
      const sway = Math.sin(t * Math.PI) * (1 - t);
      heroY.set(at < OUT ? now - g.rest : g.from.y - g.rest);
      heroOpacity.set(at < OUT ? 1 : 0);
      opacity.set(at >= OUT && at < g.land ? 1 : 0);
      x.set(mix(g.from.x, g.to.x, glide(t)) + sway * g.arc);
      y.set(now);
      rotate.set(sway * 12);
      scale.set(mix(1, g.to.w / g.from.w, ease(t)));
      diskY.set(Math.min(0, now - g.slot));
      diskOpacity.set(at >= g.land ? 1 : 0);
      diskFlap.set(
        at < g.done ? span(at, [g.land - 240, g.land - 40]) : 1 - span(at, [g.done, g.done + 120]),
      );
      setLanded(at >= g.done);
    },
    [heroFlap, heroY, heroOpacity, diskFlap, diskY, diskOpacity, x, y, rotate, scale, opacity],
  );

  useMotionValueEvent(scrollY, "change", apply);

  useLayoutEffect(() => {
    const root = ref.current;
    if (still || !root) return;
    const update = () => {
      geo.current = measure(root);
      const g = geo.current;
      if (g)
        setSize((old) =>
          old && Math.abs(old.w - g.from.w) < 0.5 && Math.abs(old.h - g.from.h) < 0.5
            ? old
            : { w: g.from.w, h: g.from.h },
        );
      apply(window.scrollY);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, [still, apply]);

  const journey = useMemo(
    () => ({ heroFlap, heroY, heroOpacity, diskFlap, diskY, diskOpacity, landed }),
    [heroFlap, heroY, heroOpacity, diskFlap, diskY, diskOpacity, landed],
  );

  if (still) return children;

  return (
    <JourneyContext value={journey}>
      <div ref={ref} className="relative">
        {children}
        {size && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 z-30"
            style={{ x, y, rotate, scale, opacity, originX: 0, originY: 0 }}
          >
            <div className="-translate-1/2" style={{ width: size.w, height: size.h }}>
              <JourneyPaper />
            </div>
          </motion.div>
        )}
      </div>
    </JourneyContext>
  );
}
