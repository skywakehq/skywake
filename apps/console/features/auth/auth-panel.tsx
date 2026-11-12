import { Logo } from "@skywake/ui/components/logo";
import { AuthGrid } from "./auth-grid";

// The landing page's numbers. The console can't import the site, so they are copied.
const STATS = [
  { figure: "300×", line: "faster than copying 1 GB" },
  { figure: "411 ms", line: "cold search, 10M vectors" },
];

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
      <Logo className="size-[18px]" />
      Skywake.
    </span>
  );
}

/** The left half of the sign-in pages: the grid, the name and what it is. */
export function AuthPanel() {
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border p-10 lg:flex">
      <AuthGrid />
      <div className="relative">
        <Wordmark />
      </div>
      <div className="relative">
        <h2 className="text-[clamp(2rem,1.2rem+2vw,3rem)] leading-[1.05] font-medium tracking-[-0.03em] text-foreground">
          Files and search
          <br />
          for your agents.
        </h2>
        <dl className="mt-10 grid grid-cols-2 border-t border-border">
          {STATS.map((stat, i) => (
            <div key={stat.line} className={i === 1 ? "border-l border-border pt-6 pl-6" : "pt-6"}>
              <dt className="sr-only">{stat.line}</dt>
              <dd className="text-[23.5px] leading-none tracking-[-0.03em] text-foreground tabular-nums">
                {stat.figure}
              </dd>
              <dd className="mt-2 text-[13px] leading-5 text-muted-foreground">{stat.line}</dd>
            </div>
          ))}
        </dl>
      </div>
    </aside>
  );
}
