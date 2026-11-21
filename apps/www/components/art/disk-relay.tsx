"use client";

import { Eye, FileText, Pencil } from "lucide-react";
import {
  AnimatePresence,
  type MotionValue,
  motion,
  useMotionValue,
  useTransform,
} from "motion/react";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";

import {
  DROP_PX,
  JOURNEY_FILE,
  JourneyPaper,
  paperBox,
  useJourney,
} from "@/components/art/file-journey";
import { useLoop } from "@/components/art/use-loop";
import { AGENTS, AgentLogo } from "@/components/ui/agent-logos";
import { FolderBack, FolderFront } from "@/components/ui/folder-icon";
import { cn } from "@/lib/utils";

const STEP_MS = 1600;
const REST_STEPS = 3;
const FLIGHT_S = 0.75;
const MOUTH = 0.3;

type Beat = { file: string; by?: number; to?: number[] };

const INTRO: Beat[] = [{ file: JOURNEY_FILE }, { file: JOURNEY_FILE, to: [0, 1, 2, 3] }];

const SCRIPT: Beat[] = [
  { file: "plan.md", by: 0 },
  { file: "plan.md", to: [1, 2] },
  { file: "src/auth.ts", by: 1 },
  { file: "src/auth.ts", to: [3, 0] },
  { file: "notes/bugs.md", by: 2 },
  { file: "notes/bugs.md", to: [3, 1] },
  { file: "tests/auth.test.ts", by: 3 },
  { file: "tests/auth.test.ts", to: [0, 2] },
];

type Drop = { y: MotionValue<number>; opacity: MotionValue<number> };
type DiskFile = { name: string; writer?: number; readers: number[] };
type Point = { x: number; y: number };
type Layout = { disk: Point; agents: Point[]; width: number; height: number };

function timeline(step: number) {
  if (step < INTRO.length) return { beats: INTRO.slice(0, step + 1), now: INTRO[step] };
  const at = (step - INTRO.length) % (SCRIPT.length + REST_STEPS);
  return {
    beats: [...INTRO, ...SCRIPT.slice(0, Math.min(at + 1, SCRIPT.length))],
    now: SCRIPT[at],
  };
}

function filesAfter(beats: Beat[]) {
  const files: DiskFile[] = [];
  for (const beat of beats) {
    const file = files.find((f) => f.name === beat.file);
    if (beat.to && file) file.readers.push(...beat.to.filter((r) => !file.readers.includes(r)));
    else if (!beat.to) files.push({ name: beat.file, writer: beat.by, readers: [] });
  }
  return files;
}

const involves = (beat: Beat | undefined, agent: number) =>
  beat?.by === agent || (beat?.to?.includes(agent) ?? false);

function FileMark({ writer, className }: { writer?: number; className: string }) {
  return writer === undefined ? (
    <FileText className={cn("shrink-0 text-signal", className)} />
  ) : (
    <AgentLogo agent={AGENTS[writer]!} className={className} />
  );
}

const POP = { type: "spring", stiffness: 420, damping: 22 } as const;
const TILT = [-2.5, 2, 2.5, -2];
const PAPER_TILT = [-3, 2, -1.5, 3];
const SPARKS = [-150, -115, -80, -45, -15, -165];

function useLayout(
  stage: RefObject<HTMLDivElement | null>,
  mouth: RefObject<HTMLDivElement | null>,
  logos: RefObject<(HTMLSpanElement | null)[]>,
) {
  const [layout, setLayout] = useState<Layout | null>(null);

  useLayoutEffect(() => {
    const root = stage.current;
    if (!root) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      const center = (el: Element | null | undefined, dy = 0.5): Point => {
        const r = el?.getBoundingClientRect() ?? box;
        return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height * dy };
      };
      setLayout({
        disk: center(mouth.current, MOUTH),
        agents: (logos.current ?? []).map((el) => center(el)),
        width: box.width,
        height: box.height,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [stage, mouth, logos]);

  return layout;
}

function Wires({ layout, beat }: { layout: Layout; beat?: Beat }) {
  const { disk } = layout;
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
    >
      {layout.agents.map((a, i) => {
        const d = `M${a.x} ${a.y} C${(a.x + disk.x) / 2} ${a.y} ${(a.x + disk.x) / 2} ${disk.y} ${disk.x} ${disk.y}`;
        const on = involves(beat, i);
        return (
          <g key={i}>
            <path
              d={d}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.18}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="0.1 8"
            />
            <path
              d={d}
              fill="none"
              stroke="var(--sun)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray="0.1 8"
              className={cn(
                "wire transition-opacity duration-300",
                on ? "opacity-100" : "opacity-0",
              )}
            />
          </g>
        );
      })}
    </svg>
  );
}

function Flight({
  layout,
  agent,
  write,
  file,
  writer,
}: {
  layout: Layout;
  agent: number;
  write: boolean;
  file: string;
  writer?: number;
}) {
  const at = layout.agents[agent];
  if (!at) return null;
  const [from, to] = write ? [at, layout.disk] : [layout.disk, at];
  const lift = Math.min(from.y, to.y) - 70;
  return (
    <motion.div
      className="pointer-events-none absolute top-0 left-0 z-30"
      initial={{ x: from.x, y: from.y, opacity: 0, scale: 0.6, rotate: -8 }}
      animate={{
        x: [from.x, (from.x + to.x) / 2, to.x],
        y: [from.y, lift, to.y],
        opacity: [0, 1, 1, 0],
        scale: [0.6, 1.05, 0.7],
        rotate: [-8, 6, 0],
      }}
      transition={{ duration: FLIGHT_S, ease: "easeInOut" }}
    >
      <div className="sheet flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-lg px-2 py-1.5 font-mono text-[11px] whitespace-nowrap">
        <FileMark writer={writer} className="size-4" />
        {file}
      </div>
    </motion.div>
  );
}

function Sparks({ at, color }: { at: Point; color: string }) {
  return (
    <div className="pointer-events-none absolute z-30" style={{ left: at.x, top: at.y }}>
      {SPARKS.map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        return (
          <motion.span
            key={deg}
            className="absolute size-2 -translate-1/2 rounded-full"
            style={{ background: i % 2 ? "var(--sun)" : color }}
            initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
            animate={{
              x: Math.cos(rad) * 46,
              y: Math.sin(rad) * 46,
              scale: [0, 1.2, 0],
              opacity: [1, 1, 0],
            }}
            transition={{ delay: FLIGHT_S - 0.1, duration: 0.55, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}

function Session({
  agent,
  machine,
  beat,
  active,
  verbs,
  logoRef,
  className,
}: {
  agent: number;
  machine: string;
  beat?: Beat & { write: boolean };
  active: boolean;
  verbs: { write: string; read: string };
  logoRef: (el: HTMLSpanElement | null) => void;
  className?: string;
}) {
  const Icon = beat?.write ? Pencil : Eye;
  return (
    <div
      className={cn(
        "tile relative z-10 w-full p-3 transition-[box-shadow,scale] duration-300 sm:p-4 lg:max-w-[17rem]",
        active && "scale-[1.03] shadow-[0_0_0_2px_var(--sun),var(--lift)]",
        className,
      )}
      style={{ rotate: `${TILT[agent]}deg` }}
    >
      <div className="flex items-center gap-3">
        <motion.span
          ref={logoRef}
          animate={active ? { y: [0, -6, 0], rotate: [0, -8, 0] } : { y: 0, rotate: 0 }}
          transition={{ duration: 0.5 }}
        >
          <AgentLogo agent={AGENTS[agent]!} className="size-9 sm:size-10" />
        </motion.span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{AGENTS[agent]!.name}</p>
          <p className="truncate text-xs text-muted-foreground">{machine}</p>
        </div>
      </div>
      <div className="mt-3 flex h-9 items-center overflow-hidden rounded-xl bg-(--soft) px-3 font-mono text-xs">
        <AnimatePresence mode="popLayout" initial={false}>
          {beat ? (
            <motion.p
              key={`${beat.file}-${beat.write}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: { delay: beat.write ? 0 : FLIGHT_S - 0.15 },
              }}
              exit={{ opacity: 0, y: -12 }}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              <Icon className="size-3.5 shrink-0 text-signal" />
              <span className="hidden text-muted-foreground sm:inline">
                {beat.write ? verbs.write : verbs.read}
              </span>
              <span className="truncate text-foreground">{beat.file}</span>
            </motion.p>
          ) : (
            <motion.span key="idle" exit={{ opacity: 0 }} className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="size-1.5 rounded-full bg-muted-foreground/50"
                  animate={{ y: [0, -3, 0] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Readers({ readers }: { readers: number[] }) {
  return (
    <span className="hidden items-center sm:flex">
      {readers.map((reader) => (
        <motion.span
          key={reader}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={POP}
          className="-ml-1"
        >
          <AgentLogo agent={AGENTS[reader]!} className="size-4 ring-2 ring-(--paper)" />
        </motion.span>
      ))}
    </span>
  );
}

function Paper({
  file,
  index,
  count,
  drop,
}: {
  file: DiskFile;
  index: number;
  count: number;
  drop?: Drop;
}) {
  if (file.writer === undefined) {
    return (
      <motion.li
        className="absolute"
        style={{ ...paperBox, ...drop }}
        initial={drop ? false : { y: -DROP_PX }}
        animate={drop ? undefined : { y: 0, transition: POP }}
        exit={{ y: -120, opacity: 0 }}
      >
        <JourneyPaper />
      </motion.li>
    );
  }
  return (
    <motion.li
      className="sheet absolute inset-x-[9%] top-[30%] h-[62%] rounded-xl px-2.5 pt-2 sm:px-3"
      initial={{ y: -DROP_PX, opacity: 0, rotate: -14 }}
      animate={{
        y: -(count - index) * 32,
        opacity: 1,
        rotate: PAPER_TILT[index % PAPER_TILT.length],
        transition: { ...POP, delay: index === count - 1 ? FLIGHT_S - 0.15 : 0 },
      }}
      exit={{ y: -120, opacity: 0 }}
    >
      <div className="flex items-center gap-2">
        <FileMark writer={file.writer} className="size-5" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{file.name}</span>
        <Readers readers={file.readers} />
      </div>
    </motion.li>
  );
}

function Disk({
  files,
  landed,
  mouthRef,
  mounted,
  flap,
  drop,
}: {
  files: DiskFile[];
  landed: number;
  mouthRef: RefObject<HTMLDivElement | null>;
  mounted: string;
  flap: MotionValue<number>;
  drop?: Drop;
}) {
  const tilt = useTransform(flap, [0, 1], [0, 40]);
  return (
    <div className="relative z-20 flex flex-col items-center pt-28 sm:pt-32">
      <div className="absolute top-1/2 left-1/2 size-[130%] -translate-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--sun)_22%,transparent),transparent)]" />
      <motion.div
        ref={mouthRef}
        data-journey-target
        key={landed}
        initial={{ scaleX: 1, scaleY: 1 }}
        animate={{ scaleX: [1, 1.06, 0.98, 1], scaleY: [1, 0.92, 1.03, 1] }}
        transition={{ delay: FLIGHT_S - 0.1, duration: 0.5 }}
        className="relative aspect-[100/82] w-60 origin-bottom sm:w-72 lg:w-[22rem]"
      >
        <FolderBack className="absolute inset-0 size-full" />
        <ul className="absolute inset-0">
          <AnimatePresence>
            {files.map((file, i) => (
              <Paper key={file.name} file={file} index={i} count={files.length} drop={drop} />
            ))}
          </AnimatePresence>
        </ul>
        <motion.div
          className="absolute inset-0 drop-shadow-[0_-4px_8px_rgb(0_0_0/0.12)]"
          style={{ rotateX: tilt, originY: 0.93, transformPerspective: 700 }}
        >
          <FolderFront className="absolute inset-0 size-full" />
          <div className="absolute inset-x-0 bottom-[14%] text-center text-[#5c3b00]">
            <p className="text-sm font-semibold sm:text-base">team-disk</p>
            <p className="font-mono text-[10px] opacity-70 sm:text-xs">/mnt/skywake</p>
          </div>
        </motion.div>
      </motion.div>
      <div className="mt-2 h-3 w-48 rounded-[50%] bg-black/15 blur-md dark:bg-black/50" />
      <p className="mt-3 flex items-center gap-2 rounded-full bg-(--soft) px-3 py-1.5 text-xs text-muted-foreground">
        <span className="relative flex size-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-[#3dd68c] opacity-60" />
          <span className="size-2 rounded-full bg-[#3dd68c]" />
        </span>
        {mounted}
      </p>
    </div>
  );
}

type RelayProps = {
  machines: string[];
  mounted: string;
  verbs: { write: string; read: string };
};

function Relay({
  machines,
  mounted,
  verbs,
  held,
  flap,
  drop,
}: RelayProps & {
  held: boolean;
  flap: MotionValue<number>;
  drop?: Drop;
}) {
  const { ref, step, still } = useLoop<HTMLDivElement>(
    STEP_MS,
    INTRO.length + SCRIPT.length - 1,
    !held,
  );
  const mouthRef = useRef<HTMLDivElement>(null);
  const logos = useRef<(HTMLSpanElement | null)[]>([]);
  const layout = useLayout(ref, mouthRef, logos);

  const { beats, now: current } = held
    ? { beats: INTRO.slice(0, 1), now: undefined }
    : timeline(step);
  const files = filesAfter(beats);
  const now = still ? undefined : current;
  const writer = (name: string) => files.find((file) => file.name === name)?.writer;

  const session = (agent: number, className?: string) => {
    const last = beats.filter((beat) => involves(beat, agent)).at(-1);
    return (
      <Session
        key={agent}
        agent={agent}
        machine={machines[agent]!}
        beat={last && { ...last, write: last.by === agent }}
        active={involves(now, agent)}
        verbs={verbs}
        logoRef={(el) => {
          logos.current[agent] = el;
        }}
        className={className}
      />
    );
  };

  return (
    <div
      ref={ref}
      aria-hidden
      className="relative grid grid-cols-2 gap-3 text-foreground lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-x-10 lg:gap-y-32"
    >
      {layout && <Wires layout={layout} beat={now} />}
      <div className="col-span-2 mb-6 lg:col-span-1 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mb-0 lg:self-center">
        <Disk
          files={files}
          landed={held ? 0 : files.length}
          mouthRef={mouthRef}
          mounted={mounted}
          flap={flap}
          drop={drop}
        />
      </div>
      {session(0, "lg:col-start-1 lg:row-start-1 lg:self-end")}
      {session(2, "lg:col-start-3 lg:row-start-1 lg:self-end lg:justify-self-end")}
      {session(1, "lg:col-start-1 lg:row-start-2 lg:self-start")}
      {session(3, "lg:col-start-3 lg:row-start-2 lg:self-start lg:justify-self-end")}
      {layout &&
        now &&
        (now.by !== undefined ? [now.by] : (now.to ?? [])).map((agent) => (
          <Flight
            key={`f${step}-${agent}`}
            layout={layout}
            agent={agent}
            write={now.by === agent}
            file={now.file}
            writer={writer(now.file)}
          />
        ))}
      {layout && now && !now.to && (
        <Sparks
          key={`s${step}`}
          at={layout.disk}
          color={now.by === undefined ? "var(--sun)" : AGENTS[now.by]!.tile}
        />
      )}
    </div>
  );
}

/** Four agents on four machines around one disk: a file dropped in reaches them all, then they write and read each other's. */
export function DiskRelay(props: RelayProps) {
  const journey = useJourney();
  const rest = useMotionValue(0);
  const held = journey ? !journey.landed : false;
  return (
    <Relay
      key={held ? "held" : "live"}
      {...props}
      held={held}
      flap={journey?.diskFlap ?? rest}
      drop={journey ? { y: journey.diskY, opacity: journey.diskOpacity } : undefined}
    />
  );
}
