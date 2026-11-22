import { FolderBack, FolderFront } from "@skywake/ui/components/folder-icon";
import { Logo } from "@skywake/ui/components/logo";

const LOOP =
  "M60 30C50 16 42 10 32 10a20 20 0 0 0 0 40c10 0 18-6 28-20 10-14 18-20 28-20a20 20 0 0 1 0 40c-10 0-18-6-28-20z";

/** The landing page's infinity sign: one warm ribbon that crosses over itself. */
function InfinityLoop({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 60" aria-hidden fill="none" className={className}>
      <path d={LOOP} stroke="#f7b52c" strokeWidth="11" />
      <path
        d={LOOP}
        pathLength="100"
        stroke="var(--panel-bg)"
        strokeWidth="19"
        strokeDasharray="9 91"
        strokeDashoffset="-45.5"
      />
      <path
        d={LOOP}
        pathLength="100"
        stroke="#f7b52c"
        strokeWidth="11"
        strokeDasharray="16 84"
        strokeDashoffset="-42"
      />
    </svg>
  );
}

/** A file peeking out of the folder, with its kind, name and size. */
function Paper({
  kind,
  tint,
  name,
  size,
  className,
}: {
  kind: string;
  tint: string;
  name: string;
  size: string;
  className: string;
}) {
  return (
    <div
      className={`absolute flex h-[70%] w-[80%] flex-col gap-2 rounded-xl bg-[#f7f5f0] p-3 text-[#1d1b18] ${className}`}
    >
      <div className="flex items-center gap-2 text-[11px] leading-none">
        <span
          className="rounded-[4px] px-1.5 py-1 text-[9px] font-bold text-white"
          style={{ background: tint }}
        >
          {kind}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
        <span className="font-mono opacity-50">{size}</span>
      </div>
      <div className="grid gap-1.5 pt-1">
        <span className="h-1.5 w-4/5 rounded-full bg-current opacity-15" />
        <span className="h-1.5 w-3/5 rounded-full bg-current opacity-15" />
        <span className="h-1.5 w-2/3 rounded-full bg-current opacity-15" />
      </div>
    </div>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-[15px] font-medium tracking-[-0.01em] text-foreground">
      <Logo className="size-[18px]" />
      Skywake
    </span>
  );
}

/** The left half of the sign-in pages: the landing page's folder and headline. */
export function AuthPanel({ site }: { site: string }) {
  return (
    <aside className="relative m-3 hidden flex-col justify-between overflow-hidden rounded-[28px] bg-(--panel-bg) p-10 ring-1 ring-foreground/[0.06] [--panel-bg:color-mix(in_oklab,var(--foreground)_3%,var(--background))] lg:flex">
      <a href={site} className="w-fit">
        <Wordmark />
      </a>
      <div aria-hidden className="mx-auto w-[min(17rem,60%)] animate-[float_5s_ease-in-out_infinite]">
        <div className="relative aspect-[100/82]">
          <FolderBack className="absolute inset-0 size-full" />
          <Paper
            kind="PDF"
            tint="#e5322d"
            name="launch-deck.pdf"
            size="200 MB"
            className="top-[-24%] left-[2%] -rotate-[9deg]"
          />
          <Paper
            kind="MD"
            tint="#3b82f6"
            name="notes.md"
            size="4 KB"
            className="top-[-8%] left-[22%] rotate-[5deg]"
          />
          <FolderFront className="absolute inset-0 size-full" />
        </div>
      </div>
      <h2 className="text-[clamp(2rem,1.2rem+2vw,3rem)] leading-[1.08] font-medium tracking-[-0.035em] text-foreground">
        Infinite disks
        <InfinityLoop className="mx-[0.18em] inline-block h-[0.6em] w-auto -translate-y-[0.04em] align-baseline" />
        <br />
        <span className="text-muted-foreground">for AI agents.</span>
      </h2>
    </aside>
  );
}
