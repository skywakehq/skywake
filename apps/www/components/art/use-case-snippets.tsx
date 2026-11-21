import { Check, ChevronRight, File, Folder, GitBranch, Search } from "lucide-react";

const TONE = "var(--signal)";
const SECOND_TONE = "#5cc495";

const ROW = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
const QUIET = "text-muted-foreground";
const MONO = "font-mono text-[12px]";

type Snippet = () => React.ReactNode;

function Hit({ path, children }: { path: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className={`${MONO} ${QUIET}`}>{path}</span>
      <p className={`${QUIET} [&_b]:font-medium [&_b]:text-foreground`}>{children}</p>
    </div>
  );
}

/** Knowledge base: a search, and the matching lines from the docs. */
const Knowledge: Snippet = () => (
  <div className="grid gap-4">
    <div className="flex h-9 items-center gap-2 rounded-lg bg-foreground/[0.06] px-3">
      <Search className={`size-3.5 ${QUIET}`} />
      refund annual plan
    </div>
    <div className="grid gap-3">
      <Hit path="docs/billing/refunds.md">
        <b>Annual plans</b> can be <b>refunded</b> in full within 30 days.
      </Hit>
      <Hit path="docs/billing/changes.md">
        Upgrade any time. <b>Annual plans</b> are prorated.
      </Hit>
    </div>
  </div>
);

/** Context layer: an agent's notes, kept as a plain file other agents can read. */
const Context: Snippet = () => (
  <div className="grid">
    <div className={ROW}>
      <Folder className={`size-3.5 ${QUIET}`} /> memory
      <ChevronRight className={`size-3 ${QUIET}`} /> agent-a
    </div>
    <div className={`${ROW} rounded-md border-transparent bg-foreground/[0.06] px-2`}>
      <File className={`size-3.5 ${QUIET}`} /> notes.md
      <span className="ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <span className="size-1.5 rounded-full" style={{ background: TONE }} />
        Read by 3 agents
      </span>
    </div>
    <ul className={`grid gap-1.5 px-2 pt-3 ${MONO} ${QUIET}`}>
      <li>- Customer prefers yearly billing</li>
      <li>- Last run stopped at step 4</li>
      <li>- Use the staging bucket for tests</li>
    </ul>
  </div>
);

/** Shared filesystem: two agents in one file, saved to the bucket a moment ago. */
const Shared: Snippet = () => {
  const cursor = (name: string, color: string) => (
    <span className="relative inline-block h-4 w-px align-middle" style={{ background: color }}>
      <span
        className="absolute -top-4 left-0 rounded px-1 text-[10px] leading-4 whitespace-nowrap text-background"
        style={{ background: color }}
      >
        {name}
      </span>
    </span>
  );
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <File className={`size-3.5 ${QUIET}`} /> report.md
        <span className="ml-auto text-[12px] whitespace-nowrap text-muted-foreground">
          Saved · 2s ago
        </span>
      </div>
      <div className={`grid gap-3 leading-6 ${QUIET}`}>
        <p>Revenue grew{cursor("agent-1", TONE)} 18% this quarter, led by annual plans.</p>
        <p>Churn fell{cursor("agent-2", SECOND_TONE)} to 2.1%, the lowest since launch.</p>
      </div>
    </div>
  );
};

/** Coding agents: one fix tried five ways, each on its own branch. The best one merges. */
const Coding: Snippet = () => (
  <div className="grid">
    <div className={ROW}>
      <GitBranch className={`size-3.5 ${QUIET}`} /> main
    </div>
    {[1, 2, 3, 4, 5].map((n) => (
      <div key={n} className={`${ROW} pl-6`}>
        <GitBranch className={`size-3.5 ${QUIET}`} />
        <span className={n === 3 ? "" : QUIET}>try-{n}</span>
        <span className="ml-auto flex items-center gap-3 text-[12px] text-muted-foreground">
          {n === 3 && (
            <span
              className="flex items-center gap-1 rounded-full px-2 leading-5"
              style={{
                color: TONE,
                background: `color-mix(in oklab, ${TONE} 14%, transparent)`,
              }}
            >
              <Check className="size-3" /> Merged
            </span>
          )}
        </span>
      </div>
    ))}
  </div>
);

/** Evals: many runs from the same start. The best score stands out. */
const Evals: Snippet = () => {
  const runs = [0.71, 0.68, 0.83, 0.92, 0.77];
  const best = Math.max(...runs);
  return (
    <div className="grid">
      <div className={`${ROW} text-[12px] ${QUIET}`}>
        <span className="w-16">Run</span>
        <span className="flex-1">Score</span>
        <span className={MONO}>from c76ff44</span>
      </div>
      {runs.map((score, i) => (
        <div key={i} className={ROW}>
          <span className={`w-16 ${score === best ? "" : QUIET}`}>run-{i + 1}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${score * 100}%`,
                background:
                  score === best ? TONE : "color-mix(in oklab, var(--foreground) 25%, transparent)",
              }}
            />
          </span>
          <span className={`w-10 text-right tabular-nums ${score === best ? "" : QUIET}`}>
            {score.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
};

/** Same order as useCases.items. */
export const SNIPPETS: Snippet[] = [Knowledge, Context, Shared, Coding, Evals];
