// The index's benchmark results, one row each, laid into the frame.
import type { HomeMessages } from "@/content/messages";
import { CompareBars } from "@/components/art/compare-bars";
import { searchBars } from "@/content/numbers";
import { cn } from "@/lib/utils";
import { Band } from "@/components/ui/frame";
import { Head } from "@/components/ui/statement";

export function Benchmarks({ t }: { t: HomeMessages }) {
  return (
    <>
      <Head id="benchmarks" eyebrow={t.benchmarks.label} title={t.benchmarks.title} center />
      <BenchmarkGroups t={t} />
    </>
  );
}

/** Each result is a takeaway backed by bars, then where they were measured. */
export function BenchmarkGroups({ t }: { t: HomeMessages }) {
  const b = t.benchmarkPage;
  return (
    <>
      <Band>
        {b.charts.map((chart, i) => (
          <div
            key={chart.title}
            className={cn("px-6 py-10 sm:px-10 lg:px-12", i > 0 && "border-t border-border")}
          >
            <CompareBars
              title={chart.title}
              verdict={chart.verdict}
              rows={searchBars[i]!.map((bar, j) => ({ ...bar, label: chart.labels[j]! }))}
            />
          </div>
        ))}
      </Band>
      <Band className="t-mono px-6 py-4 text-muted-foreground sm:px-10 lg:px-12">{b.note}.</Band>
    </>
  );
}
