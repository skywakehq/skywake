"use client";

import { useQuery } from "@rocicorp/zero/react";
import { useMemo, useState } from "react";
import { envOf, nameInEnv } from "@/lib/names";
import { queries } from "@/zero/queries";
import { cx, Glide, Orb, Page, Panel, plural, Stat, Stats } from "@/components/kit";

const DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

// Counted once when the page opens, so the query stays the same while it is open.
export function since() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime() - (DAYS - 1) * DAY;
}

/** What the organization did over the last two weeks. */
export function Usage() {
  const [start] = useState(since);
  const [commits] = useQuery(queries.usage({ since: start }));
  const [branches] = useQuery(queries.orgBranches());
  const [namespaces] = useQuery(queries.namespaces());
  const [hover, setHover] = useState<number | null>(null);

  const days = useMemo(() => {
    const counts = Array.from({ length: DAYS }, (_, i) => ({
      day: start + i * DAY,
      commits: 0,
      merges: 0,
    }));
    for (const commit of commits) {
      const day = counts[Math.floor((commit.at - start) / DAY)];
      if (!day) continue;
      day.commits++;
      if (commit.merged) day.merges++;
    }
    return counts;
  }, [commits, start]);

  const perNamespace = namespaces.map((namespace) => ({
    name: namespace.name,
    branches: branches.filter((b) => b.namespace === namespace.name).length,
    commits: commits.filter((c) => c.namespace === namespace.name).length,
    merges: commits.filter((c) => c.namespace === namespace.name && c.merged).length,
  }));
  const most = Math.max(1, ...days.map((d) => d.commits));
  const shown = hover === null ? null : days[hover];
  const label = (time: number) =>
    new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const total = (pick: (row: (typeof perNamespace)[number]) => number) =>
    perNamespace.reduce((sum, row) => sum + pick(row), 0);
  const busiest = Math.max(1, ...perNamespace.map((row) => row.commits));

  return (
    <Page
      eyebrow="Organization"
      title="Usage"
      description="What your agents did over the last two weeks."
    >
      <Stats>
        <Stat
          label="Commits"
          value={commits.length}
          note="last 14 days"
          trend={days.map((d) => d.commits)}
        />
        <Stat
          label="Merges"
          value={total((row) => row.merges)}
          note="last 14 days"
          trend={days.map((d) => d.merges)}
        />
        <Stat label="Branches" value={branches.length} note="across every filesystem" />
        <Stat label="Filesystems" value={namespaces.length} note="in every environment" />
      </Stats>

      <Panel
        title="Commits per day"
        action={
          <span className="text-xs text-muted-foreground tabular-nums">
            {shown
              ? `${label(shown.day)} · ${plural(shown.commits, "commit")}, ${plural(shown.merges, "merge")}`
              : `Most in a day: ${most}`}
          </span>
        }
      >
        <div className="px-5 pt-6 pb-4">
          <div className="relative flex h-56 items-end gap-1.5" onMouseLeave={() => setHover(null)}>
            {[0.25, 0.5, 0.75, 1].map((line) => (
              <span
                key={line}
                aria-hidden
                className="absolute inset-x-0 border-t border-dashed border-line/70"
                style={{ bottom: `${line * 100}%` }}
              />
            ))}
            {days.map((day, i) => (
              <div
                key={day.day}
                onMouseEnter={() => setHover(i)}
                className="relative z-10 flex h-full flex-1 items-end"
                aria-label={`${label(day.day)}: ${day.commits} commits, ${day.merges} merges`}
              >
                <div
                  className={cx(
                    "flex w-full flex-col justify-end overflow-hidden rounded-t-[3px] transition-opacity",
                    hover !== null && hover !== i && "opacity-40",
                  )}
                  style={{
                    height: `${(day.commits / most) * 100}%`,
                    minHeight: day.commits ? 3 : 0,
                  }}
                >
                  <div className="flex-1 bg-fg/25" />
                  <div
                    className="bg-fg/85"
                    style={{ height: `${day.commits ? (day.merges / day.commits) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs text-faint">
            <span>{label(days[0].day)}</span>
            <span className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-fg/25" /> Commits
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-fg/85" /> Merges
              </span>
            </span>
            <span>Today</span>
          </div>
        </div>
      </Panel>

      <Panel title="By filesystem" count={perNamespace.length}>
        <Glide>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2.5 font-normal">Filesystem</th>
                <th className="py-2.5 font-normal max-md:hidden">Share of commits</th>
                <th className="py-2.5 text-right font-normal">Branches</th>
                <th className="py-2.5 text-right font-normal">Commits</th>
                <th className="px-4 py-2.5 text-right font-normal">Merges</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {perNamespace
                .sort((a, b) => b.commits - a.commits)
                .map((row) => (
                  <tr key={row.name} data-glide className="border-b border-line/60 last:border-0">
                    <td className="flex items-center gap-2.5 px-4 py-3">
                      <Orb name={row.name} className="size-4" />
                      <span className="font-mono font-medium">{nameInEnv(row.name)}</span>
                      <span className="ml-2 text-xs text-faint">{envOf(row.name)}</span>
                    </td>
                    <td className="w-1/3 py-3 pr-6 max-md:hidden">
                      <div className="rounded-full h-1.5 overflow-hidden bg-muted">
                        <div
                          className="h-full bg-fg/70"
                          style={{ width: `${(row.commits / busiest) * 100}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-3 text-right">{row.branches}</td>
                    <td className="py-3 text-right">{row.commits}</td>
                    <td className="px-4 py-3 text-right">{row.merges}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Glide>
      </Panel>
    </Page>
  );
}
