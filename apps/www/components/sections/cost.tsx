import { StorageChart, type StorageSeries } from "@/components/art/storage-chart";
import { CARD, Container, Section } from "@/components/ui/section";
import { costExample } from "@/content/pricing";

const { agents, workspaceGb, changed, copyMbPerSecond, forkSeconds, pricePerGbMonth } = costExample;

const series: StorageSeries[] = [
  { label: "A copy per agent", baseGb: 0, gbPerAgent: workspaceGb },
  { label: "Skywake", baseGb: workspaceGb, gbPerAgent: workspaceGb * changed, ours: true },
];

const copiesGb = agents * workspaceGb;
const forksGb = workspaceGb + agents * workspaceGb * changed;

const usd = (n: number) => (n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`);
const time = (s: number) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${Math.round(s / 60)} min`);

const comparisons = [
  {
    label: "Storage a month",
    ours: usd(forksGb * pricePerGbMonth),
    theirs: usd(copiesGb * pricePerGbMonth),
  },
  {
    label: "Before an agent starts",
    ours: time(forkSeconds),
    theirs: time((workspaceGb * 1024) / copyMbPerSecond),
  },
];

export function Cost() {
  return (
    <Section id="cost" label="Cost" title="Massive savings, even on your own bucket.">
      <Container>
        <div
          className={`${CARD} grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]`}
        >
          <div className="flex flex-col p-6 sm:p-8">
            <p className="t-mono text-muted-foreground">
              {agents} agents · {workspaceGb} GB workspace · {changed * 100}% changed each
            </p>
            <p className="t-num mt-6 text-foreground">{Math.round(copiesGb / forksGb)}×</p>
            <p className="t-body mt-2 text-muted-foreground">less storage, in the same bucket</p>
            <dl className="mt-auto pt-10">
              {comparisons.map((row) => (
                <div key={row.label} className="border-t border-border py-4">
                  <dt className="t-mono text-muted-foreground">{row.label}</dt>
                  <dd className="mt-1 flex items-baseline gap-3">
                    <span className="t-h3 text-signal tabular-nums">{row.ours}</span>
                    <span className="t-mono text-muted-foreground tabular-nums">
                      vs {row.theirs} for copies
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="border-t border-border p-6 sm:p-8 lg:border-t-0 lg:border-l">
            <p className="t-body font-medium text-foreground">Storage as the fleet grows</p>
            <div className="mt-4">
              <StorageChart maxAgents={agents} series={series} />
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
