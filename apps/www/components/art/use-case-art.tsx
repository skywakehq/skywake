"use client";

import { Check, Database, FileSpreadsheet, FileText, Receipt } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

// `play={false}` holds the art on its finished picture.
type ArtProps = { play?: boolean };

// Each loop starts on its last frame, so the server render and
// reduced-motion visitors see the finished picture, not an empty one.
function useLoop(ms: number, frames: number, play = true) {
  const [n, setN] = useState(frames - 1);
  useEffect(() => {
    if (!play || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setN((v) => (v + 1) % frames), ms);
    return () => {
      clearInterval(t);
      setN(frames - 1);
    };
  }, [ms, frames, play]);
  return n;
}

const FRAME = "grid w-64 gap-1.5 font-mono text-[11.5px]";
const ROW =
  "flex h-9 items-center gap-2.5 rounded-lg px-3 transition-[color,background-color,opacity] duration-500";
const PLAIN = "bg-background text-foreground";
const QUIET = "bg-foreground/[0.05] text-muted-foreground";
const LIT = "bg-[color-mix(in_oklab,var(--signal)_12%,var(--background))] text-signal";

// Four agents try the same fix and run the tests. `fails` is the test that breaks.
const TESTS = 8;
const TRIES = [
  { id: "agent-12", fails: 5 },
  { id: "agent-37", fails: -1 },
  { id: "agent-41", fails: 2 },
  { id: "agent-58", fails: 6 },
];

export function CodingArt({ play }: ArtProps) {
  const n = useLoop(340, TESTS + 9, play);
  const ran = Math.min(n, TESTS);
  const judged = n > TESTS + 1;
  const kept = n > TESTS + 3;
  return (
    <div className={FRAME}>
      {TRIES.map((t) => {
        const passed = t.fails < 0 ? ran : Math.min(ran, t.fails);
        const failed = t.fails >= 0 && ran > t.fails;
        const winner = judged && t.fails < 0;
        return (
          <div
            key={t.id}
            className={`${ROW} ${winner ? LIT : PLAIN} ${judged && !winner ? "opacity-45" : ""}`}
          >
            {t.id}
            <span className="ml-auto flex items-center gap-1">
              {Array.from({ length: TESTS }, (_, k) => (
                <span
                  key={k}
                  className={`size-1.5 rounded-full transition-colors duration-300 ${
                    k < passed
                      ? winner
                        ? "bg-signal"
                        : "bg-foreground/45"
                      : failed && k === t.fails
                        ? "bg-(--love)"
                        : "bg-foreground/10"
                  }`}
                />
              ))}
            </span>
            <span className={`w-7 text-right ${winner ? "" : "text-muted-foreground"}`}>
              {passed}/{TESTS}
            </span>
          </div>
        );
      })}
      <div className={`${ROW} mt-2 ${kept ? LIT : QUIET}`}>
        main
        <span className="ml-auto flex items-center gap-1.5">
          {kept ? (
            <>
              <Check className="size-3.5" strokeWidth={2.5} /> kept agent-37
            </>
          ) : (
            "waiting for tests"
          )}
        </span>
      </div>
    </div>
  );
}

const FILES = [
  { name: "invoice-0412.pdf", Icon: Receipt, added: 4, removed: 1 },
  { name: "ledger-q3.xlsx", Icon: FileSpreadsheet, added: 12, removed: 3 },
  { name: "summary.md", Icon: FileText, added: 9, removed: 0 },
];

// An agent edits files on its copy. Nothing is real until a person approves.
export function DocumentsArt({ play }: ArtProps) {
  const n = useLoop(900, 8, play);
  const edited = Math.min(n, FILES.length);
  const approved = n >= 5;
  return (
    <div className={FRAME}>
      <p className="flex justify-between px-3 pb-1 text-muted-foreground">
        <span>{approved ? "main" : "agent-7's copy"}</span>
        <span className={approved ? "text-signal" : ""}>
          {approved ? "3 files updated" : `${edited} edited`}
        </span>
      </p>
      {FILES.map(({ name, Icon, added, removed }, i) => (
        <div key={name} className={`${ROW} ${PLAIN}`}>
          <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          {name}
          {i < edited && (
            <span key={String(approved)} className="rise-in ml-auto flex gap-1.5">
              {approved ? (
                <Check className="size-3.5 text-signal" strokeWidth={2.5} />
              ) : (
                <>
                  <span className="text-signal">+{added}</span>
                  {removed > 0 && <span className="text-muted-foreground">−{removed}</span>}
                </>
              )}
            </span>
          )}
        </div>
      ))}
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-1.5">
        <span className={`${ROW} ${QUIET}`}>Discard</span>
        <span
          className={`${ROW} justify-center gap-1.5 ${
            approved ? "bg-signal text-background" : edited === FILES.length ? LIT : QUIET
          }`}
        >
          {approved && <Check className="size-3.5" strokeWidth={2.5} />}
          {approved ? "Approved" : "Approve"}
        </span>
      </div>
    </div>
  );
}

// The first runs score under main, so the "main" label has clear space above them.
const SCORES = [49, 52, 47, 61, 70, 94, 66, 55, 73, 58];
const BEST = SCORES.indexOf(Math.max(...SCORES));
const MAIN = 58;

// Ten runs on the same data, one after another. The best one stands out.
export function ExperimentsArt({ play }: ArtProps) {
  const n = useLoop(300, SCORES.length + 9, play);
  const done = Math.min(n, SCORES.length);
  const judged = n > SCORES.length;
  return (
    <div className={`${FRAME} gap-2.5`}>
      <div className="relative flex h-36 items-end gap-1.5">
        <span
          className="absolute inset-x-0 border-t border-dashed border-muted-foreground/40"
          style={{ bottom: `${MAIN}%` }}
        >
          <span className="absolute bottom-1.5 left-0 text-[10px] leading-none text-muted-foreground">
            main · {MAIN}%
          </span>
        </span>
        {SCORES.map((score, i) => {
          const best = judged && i === BEST;
          return (
            <span
              key={i}
              className={`relative flex-1 rounded-t-md transition-[height,background-color] duration-500 ease-out ${
                best ? "bg-signal" : "bg-foreground/[0.12]"
              }`}
              style={{ height: i < done ? `${score}%` : 3 }}
            >
              {best && (
                <span className="rise-in absolute -top-5 left-1/2 -translate-x-1/2 text-signal">
                  {score}%
                </span>
              )}
            </span>
          );
        })}
      </div>
      <p className="flex justify-between text-muted-foreground">
        <span>10 runs · same data</span>
        <span className={judged ? "text-signal" : ""}>
          {judged ? `kept run-${BEST + 1}` : `run-${Math.min(done + 1, SCORES.length)}…`}
        </span>
      </p>
    </div>
  );
}

const RESULTS = [
  { file: "docs/billing.md", score: "0.92" },
  { file: "wiki/refunds.md", score: "0.88" },
  { file: "tickets/4821.md", score: "0.74" },
];

// An agent asks a question in plain words and gets the right files back.
export function KnowledgeArt({ play }: ArtProps) {
  const n = useLoop(800, RESULTS.length + 4, play);
  const shown = Math.min(n, RESULTS.length);
  return (
    <div className={FRAME}>
      <div className={`${ROW} ${PLAIN}`}>
        <span className="text-muted-foreground">?</span>
        refunds on annual plans
      </div>
      <p className="flex justify-between px-3 pt-2 pb-1 text-muted-foreground">
        <span>by meaning + keyword</span>
        <span>{shown > 0 ? "18 ms" : "…"}</span>
      </p>
      {RESULTS.map((r, i) => (
        <div
          key={r.file}
          className={`${ROW} ${i === 0 && shown > 0 ? LIT : PLAIN} ${i < shown ? "opacity-100" : "opacity-0"}`}
        >
          {r.file}
          <span className={`ml-auto ${i === 0 ? "" : "text-muted-foreground"}`}>{r.score}</span>
        </div>
      ))}
    </div>
  );
}

const MEMORY = ["notes.md", "history.jsonl", "decisions.md"];
const RECALLED = 2;

// One session saves what the agent learns. A later run searches it and gets one file back.
export function ContextArt({ play }: ArtProps) {
  const n = useLoop(800, 10, play);
  const saved = Math.min(n, MEMORY.length);
  const nextRun = n >= 5;
  const found = n >= 6;
  return (
    <div className={FRAME}>
      <p className="flex justify-between px-3 pb-1 text-muted-foreground">
        <span>agent-37 /context</span>
        <span className={nextRun ? "text-signal" : ""}>
          {nextRun ? "next run" : n === 4 ? "session ended" : `${saved} saved`}
        </span>
      </p>
      {MEMORY.map((file, i) => {
        const hit = found && i === RECALLED;
        return (
          <div
            key={file}
            className={`${ROW} ${hit ? LIT : PLAIN} ${i < saved ? "opacity-100" : "opacity-0"}`}
          >
            <FileText
              className={`size-3.5 shrink-0 ${hit ? "" : "text-muted-foreground"}`}
              strokeWidth={1.75}
            />
            {file}
            <span className={`ml-auto ${hit ? "" : "text-muted-foreground"}`}>
              {hit ? "found" : "saved"}
            </span>
          </div>
        );
      })}
      <div className={`${ROW} mt-2 ${nextRun ? PLAIN : QUIET}`}>
        <span className="text-muted-foreground">?</span>
        {nextRun ? "what did we decide on auth" : "search memory"}
      </div>
    </div>
  );
}

// A folder mounted on machine-a saves to the bucket. The machine dies,
// and the same folder mounts on machine-b with its files intact.
export function StorageArt({ play }: ArtProps) {
  const n = useLoop(900, 10, play);
  const died = n >= 3;
  const moved = n >= 5;
  const machines = [
    { id: "machine-a", state: died ? "down" : "mounted" },
    { id: "machine-b", state: moved ? "mounted" : "idle" },
  ];
  return (
    <div className={FRAME}>
      <p className="flex justify-between px-3 pb-1 text-muted-foreground">
        <span>sandbox-1842</span>
        <span className={moved ? "text-signal" : ""}>
          {moved ? "files intact" : died ? "machine-a died" : n === 0 ? "saving…" : "saved to S3"}
        </span>
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {machines.map(({ id, state }) => (
          <div
            key={id}
            className={`grid h-24 content-center gap-2 rounded-lg px-3 transition-[color,background-color,opacity] duration-500 ${
              state === "mounted" ? LIT : state === "down" ? `${QUIET} opacity-60` : PLAIN
            }`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`size-1.5 rounded-full transition-colors duration-500 ${
                  state === "mounted"
                    ? "bg-signal"
                    : state === "down"
                      ? "bg-(--love)"
                      : "bg-foreground/20"
                }`}
              />
              {id}
            </span>
            <span className={state === "idle" ? "text-muted-foreground" : ""}>
              {state === "mounted" ? "/workspace" : state}
            </span>
          </div>
        ))}
      </div>
      <div className={`${ROW} mt-2 ${PLAIN}`}>
        your S3 bucket
        <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
          <Check className="size-3.5 text-signal" strokeWidth={2.5} /> 3 files
        </span>
      </div>
    </div>
  );
}

const CI_TESTS = 6;

// A job skips the clone and the cache restore, opens a warm copy and goes straight to the tests.
export function CiArt({ play }: ArtProps) {
  const n = useLoop(450, CI_TESTS + 7, play);
  const ready = n >= 1;
  const ran = Math.max(0, Math.min(n - 2, CI_TESTS));
  const passed = ran === CI_TESTS;
  return (
    <div className={FRAME}>
      <p className="flex justify-between px-3 pb-1 text-muted-foreground">
        <span>job-4821</span>
        <span className={passed ? "text-signal" : ""}>
          {passed ? "passed" : ready ? "testing…" : "starting…"}
        </span>
      </p>
      {["git clone", "restore cache"].map((step) => (
        <div key={step} className={`${ROW} ${QUIET}`}>
          <span className="line-through">{step}</span>
          <span className="ml-auto">skipped</span>
        </div>
      ))}
      <div className={`${ROW} ${ready ? LIT : PLAIN}`}>
        warm copy
        <span className="ml-auto">{ready ? "ready" : "opening…"}</span>
      </div>
      <div className={`${ROW} ${PLAIN}`}>
        cargo test
        <span className="ml-auto flex items-center gap-1">
          {Array.from({ length: CI_TESTS }, (_, k) => (
            <span
              key={k}
              className={`size-1.5 rounded-full transition-colors duration-300 ${
                k < ran ? (passed ? "bg-signal" : "bg-foreground/45") : "bg-foreground/10"
              }`}
            />
          ))}
        </span>
        <span className={`w-7 text-right ${passed ? "text-signal" : "text-muted-foreground"}`}>
          {ran}/{CI_TESTS}
        </span>
      </div>
    </div>
  );
}

const PULLS = ["pr-510", "pr-511", "pr-512"];
const SHIPPED = 2;

// Each pull request gets its own live preview. One is approved and merged into main.
export function PreviewsArt({ play }: ArtProps) {
  const n = useLoop(800, 9, play);
  const live = Math.min(n + 1, PULLS.length);
  const merged = n >= 5;
  return (
    <div className={FRAME}>
      <p className="flex justify-between px-3 pb-1 text-muted-foreground">
        <span>previews</span>
        <span className={merged ? "text-signal" : ""}>{merged ? "1 merged" : `${live} live`}</span>
      </p>
      {PULLS.map((pull, i) => {
        const done = merged && i === SHIPPED;
        return (
          <div
            key={pull}
            className={`${ROW} ${done ? LIT : PLAIN} ${i < live ? "opacity-100" : "opacity-0"}`}
          >
            <span
              className={`size-1.5 rounded-full transition-colors duration-500 ${
                done ? "bg-signal" : "bg-foreground/45"
              }`}
            />
            /preview/{pull}
            <span className={`ml-auto ${done ? "" : "text-muted-foreground"}`}>
              {done ? "merged" : "live"}
            </span>
          </div>
        );
      })}
      <div className={`${ROW} mt-2 ${merged ? LIT : QUIET}`}>
        main
        <span className="ml-auto flex items-center gap-1.5">
          {merged ? (
            <>
              <Check className="size-3.5" strokeWidth={2.5} /> has {PULLS[SHIPPED]}
            </>
          ) : (
            "waiting for review"
          )}
        </span>
      </div>
    </div>
  );
}

const VERSIONS = [
  { name: "data · raw v1", model: "model-a" },
  { name: "exp-dedup", model: "model-b" },
];

// Two versions of one dataset, each tied to the model it trained. The better one is kept.
export function DatasetsArt({ play }: ArtProps) {
  const n = useLoop(800, 9, play);
  const kept = n >= 5;
  return (
    <div className={FRAME}>
      <p className="flex justify-between px-3 pb-1 text-muted-foreground">
        <span>datasets</span>
        <span className={kept ? "text-signal" : ""}>{n >= 2 ? "2 versions" : "1 version"}</span>
      </p>
      {VERSIONS.map(({ name, model }, i) => {
        const hit = kept && i === 1;
        return (
          <div
            key={name}
            className={`${ROW} ${hit ? LIT : PLAIN} ${n >= i * 2 ? "opacity-100" : "opacity-0"}`}
          >
            <Database
              className={`size-3.5 shrink-0 ${hit ? "" : "text-muted-foreground"}`}
              strokeWidth={1.75}
            />
            {name}
            {n > i * 2 && (
              <span className={`rise-in ml-auto ${hit ? "" : "text-muted-foreground"}`}>
                trained {model}
              </span>
            )}
          </div>
        );
      })}
      <div className={`${ROW} mt-2 ${kept ? LIT : QUIET}`}>
        data
        <span className="ml-auto flex items-center gap-1.5">
          {kept ? (
            <>
              <Check className="size-3.5" strokeWidth={2.5} /> kept exp-dedup
            </>
          ) : (
            "comparing models"
          )}
        </span>
      </div>
    </div>
  );
}

const PIECES = 12;
const JOBS = 20;

// Twenty jobs on one machine read the same big file. Each piece comes from the bucket once.
export function ReferenceArt({ play }: ArtProps) {
  const n = useLoop(350, PIECES + 8, play);
  const got = Math.min(n + 1, PIECES);
  const full = got === PIECES;
  const reading = Math.round((got / PIECES) * JOBS);
  return (
    <div className={FRAME}>
      <p className="flex justify-between px-3 pb-1 text-muted-foreground">
        <span>machine-1 /refs</span>
        <span className={full ? "text-signal" : ""}>
          {full ? "downloaded once" : `${got}/${PIECES} pieces`}
        </span>
      </p>
      <div className={`${ROW} ${PLAIN}`}>
        grch38.fa
        <span className="ml-auto flex items-center gap-1">
          {Array.from({ length: PIECES }, (_, k) => (
            <span
              key={k}
              className={`size-1.5 rounded-full transition-colors duration-300 ${
                k < got ? "bg-signal" : "bg-foreground/10"
              }`}
            />
          ))}
        </span>
      </div>
      <div className="grid gap-2.5 rounded-lg bg-background p-3">
        <span className="grid grid-cols-10 gap-1.5">
          {Array.from({ length: JOBS }, (_, k) => (
            <span
              key={k}
              className={`h-4 transition-colors duration-300 ${
                k < reading
                  ? "bg-[color-mix(in_oklab,var(--signal)_30%,var(--background))]"
                  : "bg-foreground/[0.07]"
              }`}
            />
          ))}
        </span>
        <span className="flex justify-between text-muted-foreground">
          <span>{JOBS} jobs</span>
          <span>{reading} reading</span>
        </span>
      </div>
      <div className={`${ROW} mt-2 ${PLAIN}`}>
        your S3 bucket
        <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
          <Check className="size-3.5 text-signal" strokeWidth={2.5} /> 1 download
        </span>
      </div>
    </div>
  );
}

// Keys are the use case ids in content/use-cases.ts.
const ART: Record<string, (props: ArtProps) => ReactNode> = {
  "knowledge-base": KnowledgeArt,
  "context-layer": ContextArt,
  sandboxes: StorageArt,
  "coding-agents": CodingArt,
  "document-agents": DocumentsArt,
  rl: ExperimentsArt,
  ci: CiArt,
  previews: PreviewsArt,
  datasets: DatasetsArt,
  "reference-data": ReferenceArt,
};

export function UseCaseArt({ id, play }: { id: string; play?: boolean }) {
  const Art = ART[id];
  return Art ? <Art play={play} /> : null;
}
