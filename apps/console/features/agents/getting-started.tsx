"use client";

import { Check, Lock, Plug, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { FolderBack, FolderFront } from "@skywake/ui/components/folder-icon";
import { Link, navigate } from "@/components/shell/router";
import { Button, cx } from "@/components/kit";
import { nameInEnv } from "@/lib/names";
import { nsPath } from "@/lib/paths";
import { withBase } from "@/lib/zone";
import { AGENTS, type Agent } from "./agents";
import { Confetti, useJustDone } from "./celebrate";
import { AgentMark, connectAgent } from "./connect-agent";

const STATE = "skywake:getting-started";

/** "open" once the card has shown unfinished, "closed" once put away. */
function readState() {
  try {
    return localStorage.getItem(STATE);
  } catch {
    return null;
  }
}
const listeners = new Set<() => void>();
function writeState(value: string) {
  try {
    localStorage.setItem(STATE, value);
  } catch {}
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the card has been put away, so the page shows its own empty state again. */
export function useGettingStartedClosed() {
  return useSyncExternalStore(subscribe, () => readState() === "closed", () => false);
}

type UsedKey = { name: string } | null;

/** The first key that has been used, if any: an agent, a script or the CLI has connected. */
function useUsedKey() {
  const [used, setUsed] = useState<UsedKey>();
  useEffect(() => {
    fetch(withBase("/api/keys"))
      .then((response) => (response.ok ? response.json() : []))
      .then((keys: { name: string; last_used?: string | null }[]) =>
        setUsed(keys.find((key) => key.last_used) ?? null),
      )
      .catch(() => setUsed(null));
  }, []);
  return used;
}

/** The agent a key was made for, from the name the connect dialog gives it. */
const agentOf = (key: UsedKey) =>
  key ? AGENTS.find((agent) => key.name.startsWith(`${agent.name} on `)) : undefined;

/** The disk as a folder that fills up: it lights up, an agent docks, a file drops in. */
function Progress({
  stage,
  agent,
  file,
}: {
  stage: number;
  agent?: Agent;
  file?: string;
}) {
  return (
    <div aria-hidden className="relative mx-auto w-36 animate-[float_5s_ease-in-out_infinite]">
      <div
        className={cx(
          "relative aspect-[100/82] transition-[filter,opacity] duration-700",
          stage < 1 && "opacity-35 grayscale",
        )}
      >
        <FolderBack className="absolute inset-0 size-full" />
        {stage >= 3 && (
          <div
            className="absolute top-[-14%] left-[16%] flex h-[66%] w-[68%] animate-[drop-in_0.7s_cubic-bezier(.2,.8,.3,1.2)_both] flex-col gap-1.5 rounded-lg bg-[#f7f5f0] p-2.5 text-[#1d1b18] [--tilt:-4deg]"
          >
            <span className="flex items-center gap-1.5 text-[9px] leading-none">
              <span className="rounded-[3px] bg-[#3b82f6] px-1 py-0.5 text-[7px] font-bold text-white">
                NEW
              </span>
              <span className="truncate font-mono">{file?.split("/").pop() || "notes.md"}</span>
            </span>
            <span className="h-1 w-4/5 rounded-full bg-current opacity-15" />
            <span className="h-1 w-3/5 rounded-full bg-current opacity-15" />
          </div>
        )}
        <FolderFront className="absolute inset-0 size-full" />
      </div>
      {stage >= 2 && (
        <span className="absolute -right-2 bottom-1 animate-[pop_0.5s_ease-out_both]">
          {agent ? (
            <AgentMark agent={agent} className="size-10 ring-4 ring-background" />
          ) : (
            <span className="grid size-10 place-items-center rounded-[24%] bg-foreground text-background ring-4 ring-background">
              <Plug className="size-5" />
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** A step's mark: a filled tick once done, a breathing ring while next, a lock after. */
function StepMark({ done, current }: { done: boolean; current: boolean }) {
  if (done)
    return (
      <span className="grid size-[18px] shrink-0 animate-[pop_0.45s_ease-out_both] place-items-center rounded-full bg-signal text-background">
        <Check className="size-2.5" strokeWidth={3.5} />
      </span>
    );
  if (current)
    return (
      <span className="grid size-[18px] shrink-0 place-items-center rounded-full ring-[1.5px] ring-signal ring-inset">
        <span className="size-1.5 animate-breathe rounded-full bg-signal" />
      </span>
    );
  return (
    <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-tint text-muted-foreground">
      <Lock className="size-2.5" />
    </span>
  );
}

/**
 * The first run, on an environment's home: make a disk, connect an agent, see
 * it write. Each step unlocks the next; finishing all three gets a small party.
 */
export function GettingStarted({
  disks,
  agentFile,
  onNewDisk,
}: {
  disks: string[];
  /** The first file an agent wrote, once one has. */
  agentFile: string | undefined;
  onNewDisk: () => void;
}) {
  const state = useSyncExternalStore(subscribe, readState, () => null);
  const usedKey = useUsedKey();
  const first = disks[0];
  const wrote = agentFile !== undefined;
  const steps = [
    { title: "Create a disk", hint: "A place for your agent's files.", done: !!first },
    { title: "Connect an agent", hint: "Claude Code, Cursor and more.", done: !!usedKey || wrote },
    { title: "See its first file", hint: "Ask it to write something.", done: wrote },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  const next = steps.findIndex((step) => !step.done);
  const finished = next < 0;
  const won = useJustDone(usedKey === undefined ? undefined : doneCount);
  const party = won && finished;

  // Remember that it was seen unfinished, so finishing later earns the party,
  // while a team that was set up before this card never sees it.
  useEffect(() => {
    if (usedKey !== undefined && !finished && state === null) {
      writeState("open");
    }
  }, [usedKey, finished, state]);

  if (state === "closed" || usedKey === undefined) return null;
  if (finished && state !== "open") return null;

  function close() {
    writeState("closed");
  }

  const action =
    next === 0 ? (
      <Button variant="primary" className="rounded-full" onClick={onNewDisk}>
        New disk
      </Button>
    ) : next === 1 && first ? (
      <Button
        variant="primary"
        className="rounded-full"
        onClick={() => {
          connectAgent(first);
          navigate(nsPath(first));
        }}
      >
        Connect
      </Button>
    ) : next === 2 && first ? (
      <Button asChild variant="primary" className="rounded-full">
        <Link href={nsPath(first, "history")}>Open {nameInEnv(first)}</Link>
      </Button>
    ) : null;

  return (
    <section className="panel relative grid gap-x-10 gap-y-6 p-6 sm:p-7 md:grid-cols-[1fr_10rem] md:items-center">
      <button
        type="button"
        aria-label="Hide"
        onClick={close}
        className="absolute top-3.5 right-3.5 z-20 grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      >
        <X className="size-4" />
      </button>

      <div className="grid min-w-0 gap-5">
        <div className="grid gap-1">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-lg font-medium tracking-[-0.015em]">
              {finished ? "You're all set" : "Get started"}
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {doneCount} of {steps.length}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {finished
              ? `Your agent saved ${agentFile?.split("/").pop() || "its first file"}. Every change it makes shows up here.`
              : "Create a disk, connect your agent, and see it save files."}
          </p>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-tint">
          <div
            className="h-full rounded-full bg-signal transition-[width] duration-700 ease-out"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>

        <ol className="grid gap-2 sm:grid-cols-3">
          {steps.map((step, i) => {
            const current = i === next;
            return (
              <li
                key={step.title}
                className={cx(
                  "flex flex-col gap-1.5 rounded-xl p-4 ring-1",
                  !finished && "min-h-[7.5rem]",
                  current ? "bg-background ring-foreground/10" : "ring-foreground/[0.06]",
                )}
              >
                <span className="flex items-center gap-2">
                  <StepMark done={step.done} current={current} />
                  <span
                    className={cx(
                      "text-sm font-medium",
                      !current && !step.done && "text-muted-foreground",
                    )}
                  >
                    {step.title}
                  </span>
                </span>
                <span className="pl-[26px] text-xs leading-relaxed text-muted-foreground">
                  {step.hint}
                </span>
                {current && action && <div className="mt-auto pt-2 pl-[26px]">{action}</div>}
              </li>
            );
          })}
        </ol>

        {finished && (
          <div className="flex flex-wrap gap-2">
            {first && (
              <Button asChild variant="primary" className="rounded-full">
                <Link href={nsPath(first, "history")}>See what it did</Link>
              </Button>
            )}
            <Button className="rounded-full" onClick={close}>
              Done
            </Button>
          </div>
        )}
      </div>

      <div className="relative grid place-items-center gap-4 max-md:hidden">
        {(party || won) && <Confetti count={party ? 30 : 16} />}
        <Progress stage={doneCount} agent={agentOf(usedKey)} file={agentFile} />
        {doneCount < 2 && (
          <div className="flex -space-x-1.5">
            {AGENTS.map((agent) => (
              <AgentMark key={agent.id} agent={agent} className="size-5 ring-2 ring-background" />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
