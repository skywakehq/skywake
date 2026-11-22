"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@skywake/ui/components/dialog";
import { Button, cx } from "@/components/kit";
import { useUrls } from "@/components/shell/console";
import { useFleet } from "@/features/fleet/fleet";
import { envOf, nameInEnv } from "@/lib/names";
import { withBase } from "@/lib/zone";
import { AGENTS, type Agent, mcpJson, type Setup, starterPrompt } from "./agents";
import { Confetti, useJustDone } from "./celebrate";
import { useUsedKey } from "./used-key";

const OPEN = "skywake:connect-agent";
let pending: string | undefined;

/** Opens the connect dialog on a disk's page, now or once that page shows. */
export function connectAgent(ns: string) {
  pending = ns;
  window.dispatchEvent(new CustomEvent(OPEN, { detail: ns }));
}

/** Whether the connect dialog should be open on this disk's page. */
export function useConnectAgent(ns: string) {
  const [open, setOpen] = useState(() => {
    if (pending !== ns) return false;
    pending = undefined;
    return true;
  });
  useEffect(() => {
    const onOpen = (event: Event) => {
      if ((event as CustomEvent).detail !== ns) return;
      pending = undefined;
      setOpen(true);
    };
    window.addEventListener(OPEN, onOpen);
    return () => window.removeEventListener(OPEN, onOpen);
  }, [ns]);
  return [open, setOpen] as const;
}

/** An agent's mark on its brand-coloured tile, like an app icon. */
export function AgentMark({ agent, className = "size-6" }: { agent: Agent; className?: string }) {
  return (
    <span
      className={cx(
        "grid shrink-0 place-items-center rounded-[24%] ring-1 ring-foreground/10",
        className,
      )}
      style={{ background: agent.tile }}
    >
      <svg viewBox="0 0 24 24" aria-hidden className="size-[60%]" style={{ fill: agent.ink }}>
        <path d={agent.mark} />
      </svg>
    </span>
  );
}

/** Text to copy, in a quiet box with a copy button. */
function CopyBox({ text, mono = true }: { text: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const Icon = copied ? Check : Copy;
  return (
    <div className="group relative rounded-xl bg-tint">
      <pre
        className={cx(
          "max-h-48 overflow-auto px-3.5 py-3 pr-11 text-[12.5px] leading-relaxed whitespace-pre-wrap break-all text-foreground",
          mono ? "font-mono" : "font-sans",
        )}
      >
        {text}
      </pre>
      <button
        type="button"
        aria-label="Copy"
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
        }}
        className="absolute top-2 right-2 grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      >
        <Icon className="size-3.5" />
      </button>
    </div>
  );
}

type Made = { id: string; key: string };

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-[1.5rem_1fr] gap-x-3 gap-y-3">
      {done ? (
        <span className="grid size-6 animate-[pop_0.45s_ease-out_both] place-items-center rounded-full bg-signal text-background">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      ) : (
        <span className="grid size-6 place-items-center rounded-full bg-tint text-xs text-muted-foreground tabular-nums">
          {n}
        </span>
      )}
      <h3 className="self-center text-sm font-medium">{title}</h3>
      <div className="col-start-2 grid min-w-0 gap-3">{children}</div>
    </section>
  );
}

/** The three wins after the key is made, as dots on a line that fill in. */
function Track({ reached, file }: { reached: number; file?: string }) {
  const marks = ["Key", "Connected", file ?? "First file"];
  return (
    <ol className="flex min-w-0 items-center gap-2 text-xs">
      {marks.map((label, i) => {
        const done = i < reached;
        const current = i === reached;
        return (
          <li key={i} className="flex min-w-0 items-center gap-2">
            {i > 0 && (
              <span className="h-0.5 w-5 overflow-hidden rounded-full bg-tint max-sm:w-3">
                <span
                  className="block h-full bg-signal transition-[width] duration-500"
                  style={{ width: done ? "100%" : "0%" }}
                />
              </span>
            )}
            {done ? (
              <span className="grid size-4 shrink-0 animate-[pop_0.45s_ease-out_both] place-items-center rounded-full bg-signal text-background">
                <Check className="size-2.5" strokeWidth={3.5} />
              </span>
            ) : (
              <span
                className={cx(
                  "size-2.5 shrink-0 rounded-full",
                  current ? "animate-breathe bg-signal" : "bg-foreground/15",
                )}
              />
            )}
            <span
              className={cx(
                "truncate",
                done ? "text-foreground" : current ? "text-foreground" : "text-muted-foreground",
                i === 2 && file && "font-mono",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Puts a disk in an agent: pick the agent, make a key for this disk alone,
 * and copy its setup. It then waits for the agent's first call and first write.
 */
export function ConnectAgent({
  ns,
  open,
  onOpenChange,
}: {
  ns: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const urls = useUrls();
  const fleet = useFleet({ ns });
  const [agent, setAgent] = useState(AGENTS[0]!);
  const [made, setMade] = useState<Made>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const seen = !!useUsedKey({ id: made?.id, enabled: !!made });
  const disk = nameInEnv(ns);
  const wrote = made
    ? fleet.commits.find((commit) => commit.actor === `key:${made.id}`)
    : undefined;
  const setup: Setup | undefined = made && { key: made.key, disk, api: urls.api };

  async function makeKey() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(withBase("/api/keys"), {
        method: "POST",
        body: JSON.stringify({
          name: `${agent.name} on ${disk}`,
          role: "write",
          environment: envOf(ns),
          only: [disk],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? data.message ?? "Could not make a key");
      setMade({ id: data.id, key: data.key });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    setBusy(false);
  }

  const reached = !made ? 0 : wrote ? 3 : seen ? 2 : 1;
  const party = useJustDone(made ? reached : undefined);
  const file = wrote?.changes[0]?.path.split("/").pop();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[600px]" showCloseButton={false}>
        <DialogHeader className="mb-0 px-7 pt-7">
          <DialogTitle className="text-base">
            {wrote
              ? `${agent.name} saved ${file ?? "a file"} to ${disk}`
              : `Connect an agent to ${disk}`}
          </DialogTitle>
          <DialogDescription className="text-sm">
            It gets the disk&apos;s files, search and branches as tools, and works on a branch of
            its own.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[64vh] gap-7 overflow-y-auto px-7 py-6">
          <Step n={1} title="Pick your agent" done={!!made}>
            <div role="radiogroup" className="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
              {AGENTS.map((each) => (
                <button
                  key={each.id}
                  type="button"
                  role="radio"
                  aria-checked={each.id === agent.id}
                  onClick={() => setAgent(each)}
                  className={cx(
                    "flex h-11 items-center gap-2.5 rounded-xl px-3 text-left text-sm ring-1 transition-colors",
                    each.id === agent.id
                      ? "bg-selected ring-foreground/25"
                      : "ring-foreground/[0.08] hover:bg-hover",
                  )}
                >
                  <AgentMark agent={each} className="size-6" />
                  <span className="truncate">{each.name}</span>
                </button>
              ))}
            </div>
          </Step>

          <Step n={2} title={`Add Skywake to ${agent.name}`} done={seen || !!wrote}>
            {!setup ? (
              <div className="grid justify-items-start gap-2">
                <p className="text-sm text-muted-foreground">
                  We&apos;ll make a key that can read and write {disk} and nothing else.
                </p>
                <Button
                  variant="primary"
                  size="default"
                  className="rounded-full pl-2"
                  disabled={busy}
                  onClick={makeKey}
                >
                  <span className="inline-flex items-center gap-2">
                    <AgentMark
                      agent={agent}
                      className="size-5 rounded-full ring-1 ring-[color-mix(in_oklab,currentColor_30%,transparent)]"
                    />
                    Connect {agent.name}
                  </span>
                </Button>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            ) : (
              <>
                {agent.command && (
                  <>
                    <p className="text-sm text-muted-foreground">Run this in a terminal:</p>
                    <CopyBox text={agent.command(setup)} />
                  </>
                )}
                {agent.link && (
                  <Button asChild variant="primary" size="default" className="w-fit">
                    <a href={agent.link(setup).href}>
                      <ExternalLink className="size-3.5" />
                      {agent.link(setup).label}
                    </a>
                  </Button>
                )}
                {!agent.command && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {agent.link ? "Or add" : "Add"} this to{" "}
                      {agent.file ? (
                        <code className="font-mono">{agent.file}</code>
                      ) : (
                        "its MCP config"
                      )}
                      :
                    </p>
                    <CopyBox text={mcpJson(setup)} />
                  </>
                )}
                <p className="text-xs text-muted-foreground">
                  The key is in this setup and isn&apos;t shown again. Keep it private.
                </p>
              </>
            )}
          </Step>

          <Step n={3} title="Check it works" done={!!wrote}>
            <p className="text-sm text-muted-foreground">
              Start a new {agent.name} session, so it loads Skywake, and paste this:
            </p>
            <CopyBox text={starterPrompt(disk)} mono={false} />
          </Step>
        </div>

        <DialogFooter className="mt-0 items-center border-t border-foreground/[0.06] px-7 py-4 sm:justify-between">
          <div className="relative min-w-0">
            {party && <Confetti count={reached === 3 ? 30 : 12} />}
            {made ? (
              <Track reached={reached} file={file} />
            ) : (
              <p className="text-sm text-muted-foreground">Takes about a minute.</p>
            )}
          </div>
          <DialogClose asChild>
            <Button size="default" variant={wrote ? "primary" : undefined} className="rounded-full">
              {wrote ? "Done" : "Close"}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
