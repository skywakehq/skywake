import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronsUpDown,
  FolderOpen,
  GitBranch,
  TerminalSquare,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@skywake/ui/lib/utils";
import { AgentsMenu } from "./agents";
import { type Branch, type Commit, type Disk, type Drive, split, tilde } from "./desktop";
import {
  Capsule,
  CopyButton,
  EjectIcon,
  Folder,
  Spinner,
  ago,
  ease,
  useDismiss,
  useTick,
} from "./ui";

export type Busy = "mounting" | "unmounting" | undefined;

/** One disk: mount a branch of it, see how it is doing, and connect agents. */
export function DiskView({
  disk,
  branch,
  branches,
  drive,
  busy,
  problem,
  commits,
  onBranch,
  onMount,
  onUnmount,
  onReveal,
  onTerminal,
  onConsole,
  onNote,
}: {
  disk: Disk;
  branch: string;
  branches: Branch[];
  drive?: Drive;
  busy: Busy;
  problem: string;
  commits?: Commit[];
  onBranch: (branch: string) => void;
  onMount: () => void;
  onUnmount: () => void;
  onReveal: () => void;
  onTerminal: () => void;
  onConsole: () => void;
  onNote: (message: string) => void;
}) {
  return (
    <motion.article
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.3, ease }}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      {/* The toolbar, in the title bar as in Finder. */}
      <header
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 z-40 flex h-[56px] items-center gap-2 bg-content pr-3 pl-6"
      >
        <div data-tauri-drag-region className="h-full flex-1" />
        <BranchPicker
          branch={branch}
          branches={branches}
          disabled={!!drive || !!busy}
          onBranch={onBranch}
        />
        <AgentsMenu disk={disk.name} branch={branch} path={drive?.path} onNote={onNote} />
        <Capsule
          look="soft"
          onClick={onConsole}
          title="Open in the console"
          className="size-9 px-0"
        >
          <ArrowUpRight />
        </Capsule>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px] px-9 pt-[84px] pb-12">
          <Mount
            disk={disk}
            branch={branch}
            drive={drive}
            busy={busy}
            problem={problem}
            onMount={onMount}
            onUnmount={onUnmount}
            onReveal={onReveal}
            onTerminal={onTerminal}
          />
          <div className="mt-9 grid grid-cols-[minmax(0,1fr)_236px] items-start gap-4">
            <History commits={commits} branch={branch} live={!!drive} />
            <About disk={disk} branch={branch} drive={drive} />
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function BranchPicker({
  branch,
  branches,
  disabled,
  onBranch,
}: {
  branch: string;
  branches: Branch[];
  disabled: boolean;
  onBranch: (branch: string) => void;
}) {
  const names = branches.length ? branches.map((b) => b.name) : [branch];
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), box);

  // ↑, ↓ and Return belong to the menu while it is open, not to the sidebar.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") {
        setOpen(false);
        if (names[at]) onBranch(names[at]);
      } else {
        const next = at + (event.key === "ArrowDown" ? 1 : -1);
        setAt(Math.max(0, Math.min(names.length - 1, next)));
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const inside = (
    <>
      <GitBranch className="size-[15px] text-secondary" />
      <span className="max-w-[200px] truncate">{branch}</span>
    </>
  );
  // A mounted disk stays on its branch.
  if (disabled)
    return (
      <span
        title="Unmount to pick another branch"
        className="btn inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-secondary"
      >
        {inside}
      </span>
    );
  return (
    <div ref={box} className="relative">
      <Capsule
        title="Branch"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setAt(Math.max(0, names.indexOf(branch)));
          setOpen(!open);
        }}
        className={cn("h-9 pr-2.5 pl-3", open && "brightness-95 dark:brightness-150")}
      >
        {inside}
        <ChevronsUpDown className="!size-3 text-tertiary" />
      </Capsule>
      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label="Branch"
            initial={{ opacity: 0, y: -8, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
            transition={{ type: "spring", duration: 0.32, bounce: 0.22 }}
            className="popover absolute top-11 right-0 z-50 min-w-[220px] origin-top-right rounded-[16px]"
          >
            <div className="max-h-[320px] overflow-y-auto p-1.5">
              <p className="px-2.5 pt-1.5 pb-1.5 text-[11px] font-semibold text-tertiary">
                Branches
              </p>
              {names.map((name, i) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={name === branch}
                  key={name}
                  onMouseEnter={() => setAt(i)}
                  onClick={() => {
                    setOpen(false);
                    onBranch(name);
                  }}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-[9px] pr-2.5 pl-2 text-left text-[13px]",
                    i === at && "bg-fill-strong",
                  )}
                >
                  <span className="grid size-4 shrink-0 place-items-center">
                    {name === branch && <Check className="size-3.5" strokeWidth={2.5} />}
                  </span>
                  <span className="max-w-[260px] min-w-0 flex-1 truncate">{name}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The disk as a folder on this Mac: the one thing to do with it, and how it is doing. */
function Mount({
  disk,
  branch,
  drive,
  busy,
  problem,
  onMount,
  onUnmount,
  onReveal,
  onTerminal,
}: {
  disk: Disk;
  branch: string;
  drive?: Drive;
  busy: Busy;
  problem: string;
  onMount: () => void;
  onUnmount: () => void;
  onReveal: () => void;
  onTerminal: () => void;
}) {
  useTick();
  const { env, label } = split(disk.name);
  const leaf = branch === "main" ? label : `${label}@${branch.replaceAll("/", "-")}`;
  const where = drive ? tilde(drive.path) : `~/Skywake/${env ? `${env}/` : ""}${leaf}`;
  const status = statusOf(drive, busy);

  return (
    <section>
      <div className="flex items-center gap-7">
        <motion.div
          key={drive ? "on" : "off"}
          initial={{ scale: 0.9, y: drive ? 10 : -4 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ type: "spring", duration: 0.7, bounce: 0.45 }}
          whileHover={drive ? { y: -3, rotate: -1.5 } : undefined}
          onDoubleClick={drive ? onReveal : undefined}
          className="relative shrink-0"
        >
          {/* Grey until it is on this Mac; then it takes the disk's colour. */}
          <Folder
            name={drive ? disk.name : undefined}
            muted={!drive}
            open={!!drive}
            className={cn(
              "w-[112px]",
              drive
                ? "drop-shadow-[0_12px_16px_rgb(0_0_0/0.18)]"
                : "drop-shadow-[0_4px_8px_rgb(0_0_0/0.1)]",
            )}
          />
          {busy && (
            <span className="absolute inset-0 grid place-items-center pt-4 text-text">
              <Spinner className="size-6 border-2" />
            </span>
          )}
        </motion.div>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[28px] leading-8 font-bold tracking-[-0.025em]">{label}</h2>
          <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[13px]">
            <span className={cn("flex shrink-0 items-center gap-1.5 font-medium", status.tone)}>
              {status.mark}
              {status.text}
            </span>
            <span className="text-tertiary">·</span>
            <span className="truncate font-mono text-[12px] text-secondary select-text">
              {where}
            </span>
            {drive && <CopyButton text={drive.path} className="-ml-1 size-6 [&_svg]:size-3" />}
          </div>

          <div className="mt-4 flex items-center gap-2">
            {drive ? (
              <>
                <Capsule look="prominent" onClick={onReveal}>
                  <FolderOpen />
                  Show in Finder
                </Capsule>
                <Capsule onClick={onTerminal}>
                  <TerminalSquare />
                  Terminal
                </Capsule>
                <Capsule
                  onClick={onUnmount}
                  disabled={!!busy}
                  title="Save the last changes and unmount"
                >
                  {busy === "unmounting" ? <Spinner /> : <EjectIcon />}
                  {busy === "unmounting" ? "Unmounting" : "Unmount"}
                </Capsule>
              </>
            ) : (
              <Capsule
                look="prominent"
                onClick={onMount}
                disabled={!!busy}
                className="px-5 disabled:opacity-70"
              >
                {busy === "mounting" && <Spinner />}
                {busy === "mounting" ? "Mounting" : problem ? "Try again" : "Mount on this Mac"}
              </Capsule>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {drive?.state === "error" && drive.error && <Problem key="drive" text={drive.error} />}
        {problem && <Problem key="mount" text={problem} />}
      </AnimatePresence>
    </section>
  );
}

function statusOf(drive: Drive | undefined, busy: Busy) {
  if (busy === "mounting")
    return { mark: <Spinner className="size-[11px]" />, text: "Mounting", tone: "text-secondary" };
  if (!drive)
    return {
      mark: <span className="block size-[7px] rounded-full border-[1.5px] border-current" />,
      text: "Not mounted",
      tone: "text-secondary",
    };
  if (drive.state === "error")
    return {
      mark: <span className="block size-[7px] rounded-full bg-danger" />,
      text: "Not saving",
      tone: "text-danger",
    };
  if (drive.state === "syncing")
    return {
      mark: <Spinner className="size-[11px]" />,
      text: drive.pending
        ? `Saving ${drive.pending} ${drive.pending === 1 ? "change" : "changes"}`
        : "Saving",
      tone: "text-amber",
    };
  return {
    mark: (
      <span className="relative block size-[7px] rounded-full bg-green">
        <span className="absolute inset-0 animate-halo rounded-full bg-green" />
      </span>
    ),
    text: drive.saved_at ? `Mounted · saved ${ago(drive.saved_at / 1000)}` : "Mounted",
    tone: "text-green",
  };
}

function Problem({ text }: { text: string }) {
  return (
    <motion.p
      initial={{ opacity: 0, height: 0, marginTop: 0 }}
      animate={{ opacity: 1, height: "auto", marginTop: 20 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.3, ease }}
      className="flex gap-2.5 overflow-hidden rounded-[14px] bg-[color-mix(in_oklab,var(--danger),transparent_90%)] px-3.5 text-[12.5px] leading-[18px] text-danger shadow-[inset_0_0_0_0.5px_color-mix(in_oklab,var(--danger),transparent_75%)] select-text"
    >
      <AlertTriangle className="my-3 size-4 shrink-0" />
      <span className="py-[11px]">{text}</span>
    </motion.p>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="px-3 pb-2 text-[12px] font-semibold text-secondary">{title}</h2>
      <div className="card overflow-hidden rounded-[16px]">{children}</div>
    </section>
  );
}

/** The latest commits on the branch, so saves can be seen arriving. */
function History({ commits, branch, live }: { commits?: Commit[]; branch: string; live: boolean }) {
  useTick();
  return (
    <Card title={`History of ${branch}`}>
      {!commits ? (
        <div className="grid gap-4 p-4">
          {[62, 78, 48].map((width) => (
            <span
              key={width}
              className="h-2.5 animate-beat rounded-full bg-fill-strong"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      ) : commits.length === 0 ? (
        <p className="px-4 py-5 text-[12.5px] text-secondary">
          Nothing yet. Files saved in the folder show up here as commits.
        </p>
      ) : (
        <ol className="py-1.5">
          <AnimatePresence initial={false}>
            {commits.slice(0, 8).map((commit, i) => (
              <motion.li
                key={`${commit.time}-${commit.message}`}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease }}
                className="relative flex h-10 items-center gap-3 pr-4 pl-10"
              >
                {/* A rail down the side, with a stop for each commit. */}
                {i > 0 && <span className="absolute top-0 left-[19.5px] h-1/2 w-px bg-separator" />}
                {i < Math.min(commits.length, 8) - 1 && (
                  <span className="absolute bottom-0 left-[19.5px] h-1/2 w-px bg-separator" />
                )}
                <span
                  className={cn(
                    "absolute left-4 size-2 rounded-full",
                    i === 0
                      ? live
                        ? "bg-green shadow-[0_0_0_3px_color-mix(in_oklab,var(--green),transparent_80%)]"
                        : "bg-text"
                      : "bg-content shadow-[inset_0_0_0_1.5px_var(--tertiary)]",
                  )}
                />
                <span
                  className={cn("min-w-0 flex-1 truncate text-[13px]", i === 0 && "font-medium")}
                >
                  {commit.message}
                </span>
                <span className="shrink-0 text-[12px] text-tertiary tabular-nums">
                  {ago(commit.time)}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </Card>
  );
}

/** The disk's facts, as a list of settings is laid out. */
function About({ disk, branch, drive }: { disk: Disk; branch: string; drive?: Drive }) {
  const { env } = split(disk.name);
  const rows = [
    ["Environment", env || "None"],
    ["Region", disk.region],
    ["Branch", branch],
    ["On this Mac", drive ? "Mounted" : "Not mounted"],
  ];
  return (
    <Card title="About">
      <dl className="px-3.5">
        {rows.map(([name, value]) => (
          <div key={name} className="flex h-10 items-center justify-between gap-3 text-[13px]">
            <dt className="shrink-0 text-secondary">{name}</dt>
            <dd className="truncate font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
