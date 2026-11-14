"use client";

import { FileCode, FileText, GitBranch, Lock, Search, Sheet } from "lucide-react";
import { useEffect, useState } from "react";

const HOLD_MS = 4200;
const QUERY = "refunds on annual plans";

// Every path any copy can hold, in the order the list shows them.
const PATHS = [
  "docs/billing.md",
  "docs/onboarding.md",
  "docs/refund-policy.md",
  "docs/terms.md",
  "data/evals.csv",
  "data/plans.csv",
  "data/tickets.jsonl",
  "src/answer.ts",
  "src/retry.ts",
  "src/tools.ts",
];
const NOT_IN_MAIN = ["docs/refund-policy.md", "data/evals.csv", "src/retry.ts"];

type Copy = {
  id: string;
  added: string[];
  edited: string[];
  scores: Record<string, string>;
};

const COPIES: Copy[] = [
  {
    id: "main",
    added: [],
    edited: [],
    scores: { "docs/billing.md": "0.92", "docs/terms.md": "0.81", "data/plans.csv": "0.64" },
  },
  {
    id: "agent-12",
    added: ["src/retry.ts"],
    edited: ["src/answer.ts"],
    scores: { "docs/billing.md": "0.92", "docs/terms.md": "0.81", "data/plans.csv": "0.64" },
  },
  {
    id: "agent-37",
    added: ["docs/refund-policy.md"],
    edited: ["docs/billing.md", "data/plans.csv"],
    scores: { "docs/refund-policy.md": "0.95", "docs/billing.md": "0.93", "docs/terms.md": "0.81" },
  },
  {
    id: "agent-41",
    added: ["data/evals.csv"],
    edited: ["docs/terms.md"],
    scores: { "docs/billing.md": "0.92", "docs/terms.md": "0.84", "data/plans.csv": "0.64" },
  },
];
const START = 2;

// The passage the search found in a copy's best match (the first score listed).
const PASSAGES: Record<string, { title: string; before: string; hit: string; after: string }> = {
  "docs/billing.md": {
    title: "Cancelling a plan",
    before: "Monthly plans can be cancelled at any time.",
    hit: "Annual plans are refunded in full within 30 days of purchase.",
    after: "After that, the unused months are returned as account credit.",
  },
  "docs/refund-policy.md": {
    title: "Refund policy",
    before: "This replaces the 30 day rule in billing.md.",
    hit: "Annual plans are refunded pro rata for every unused month.",
    after: "The money reaches the original payment method within five days.",
  },
};

const TINT = "bg-[color-mix(in_oklab,var(--signal)_9%,var(--background))]";
const FADE = "transition-opacity duration-700 ease-out motion-reduce:transition-none";

function icon(path: string) {
  if (path.endsWith(".md")) return FileText;
  if (path.endsWith(".ts")) return FileCode;
  return Sheet;
}

export function HeroDemo() {
  const [selected, setSelected] = useState(START);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!auto || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setSelected((v) => (v + 1) % COPIES.length), HOLD_MS);
    return () => clearInterval(t);
  }, [auto]);

  return (
    <div className="text-[13px] leading-5">
      <div className="flex h-11 items-center gap-2 border-b border-border px-4 sm:px-5">
        <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
          acme <span className="opacity-50">/</span> production
          <span className="opacity-50">/</span>
          <span className="truncate text-foreground">support-kb</span>
        </p>
        <p className="ml-auto hidden font-mono text-[12px] text-muted-foreground sm:block">
          s3://acme-agents
        </p>
      </div>

      <div className="grid sm:grid-cols-[13.5rem_minmax(0,1fr)]">
        <div className="border-b border-border p-3 sm:border-r sm:border-b-0">
          <p className="flex h-8 items-center px-3 text-[12px] text-muted-foreground">Copies</p>
          <ul className="grid grid-cols-2 gap-x-1 gap-y-0.5 sm:grid-cols-1">
            {COPIES.map((copy, i) => {
              const on = i === selected;
              const changes = copy.added.length + copy.edited.length;
              return (
                <li key={copy.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setSelected(i);
                      setAuto(false);
                    }}
                    className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-3 font-mono text-[12.5px] transition-colors duration-500 motion-reduce:transition-none ${
                      on ? "bg-(--hairline) text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <GitBranch strokeWidth={1.5} className="size-4 shrink-0" />
                    {copy.id}
                    <span className="ml-auto tabular-nums">
                      {changes ? `+${changes}` : <Lock strokeWidth={1.5} className="size-3.5" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="min-w-0 bg-background">
          <div className="p-3">
            <div className="flex h-10 items-center gap-2.5 rounded-lg bg-(--soft) px-3">
              <Search strokeWidth={1.5} className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate text-[14px] text-foreground">{QUERY}</span>
              <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">3 matches</span>
            </div>
          </div>

          {/* All copies sit in one grid cell, so the pane keeps one height while they fade. */}
          <div className="grid">
            {COPIES.map((copy, i) => (
              <CopyView key={copy.id} copy={copy} shown={i === selected} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyView({ copy, shown }: { copy: Copy; shown: boolean }) {
  const files = PATHS.filter((p) => !NOT_IN_MAIN.includes(p) || copy.added.includes(p));
  const best = Object.keys(copy.scores)[0]!;
  const passage = PASSAGES[best]!;

  return (
    <div
      aria-hidden={!shown}
      className={`col-start-1 row-start-1 grid lg:grid-cols-[minmax(0,1fr)_20rem] ${FADE} ${
        shown ? "" : "pointer-events-none opacity-0"
      }`}
    >
      <ul className="grid content-start gap-0.5 px-3 pb-3">
        {files.map((path) => {
          const Icon = icon(path);
          const cut = path.indexOf("/") + 1;
          const score = copy.scores[path];
          const change = copy.added.includes(path)
            ? "added"
            : copy.edited.includes(path)
              ? "edited"
              : "";
          return (
            <li
              key={path}
              className={`grid h-9 grid-cols-[1rem_minmax(0,1fr)_3rem_2.25rem] items-center gap-x-3 rounded-lg px-3 ${
                score ? TINT : ""
              }`}
            >
              <Icon
                strokeWidth={1.5}
                className={`size-4 ${score ? "text-signal" : "text-muted-foreground"}`}
              />
              <span className="truncate font-mono text-[12.5px] text-foreground">
                <span className="text-muted-foreground">{path.slice(0, cut)}</span>
                {path.slice(cut)}
              </span>
              <span className="text-[12px] text-muted-foreground">{change}</span>
              <span className="text-right font-mono text-[12.5px] text-signal tabular-nums">
                {score}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="hidden border-l border-border px-5 pt-2 pb-5 lg:block">
        <p className="flex h-9 items-center justify-between font-mono text-[12.5px]">
          <span className="text-foreground">{best}</span>
          <span className="text-signal tabular-nums">{copy.scores[best]}</span>
        </p>
        <p className="mt-3 text-[15px] font-medium text-foreground">{passage.title}</p>
        <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
          {passage.before}{" "}
          <mark className={`rounded-sm box-decoration-clone px-0.5 text-foreground ${TINT}`}>
            {passage.hit}
          </mark>{" "}
          {passage.after}
        </p>
      </div>
    </div>
  );
}
