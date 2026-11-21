import { FolderTally } from "@/components/art/folder-tally";
import { Band } from "@/components/ui/frame";
import { Head } from "@/components/ui/statement";
import type { HomeMessages } from "@/content/messages";
import { costExample } from "@/content/pricing";

const { agents, workspaceGb, changed, pricePerGbMonth } = costExample;

const copiesGb = agents * workspaceGb;
const oursGb = workspaceGb + agents * workspaceGb * changed;

const numbers: Record<string, string> = {
  agents: String(agents),
  workspaceGb: String(workspaceGb),
  addedMb: String(Math.round((workspaceGb * changed * 1024) / 10) * 10),
};
const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, key: string) => numbers[key] ?? m);

const gb = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} TB` : `${Math.round(n)} GB`);
const usd = (n: number) => (n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`);

/** What sharing one disk saves, worked through for the example in content/pricing. */
export function Cost({ t }: { t: HomeMessages }) {
  const c = t.cost.chart;
  const words = t.cost.headline;
  const perMonth = (size: number) => c.perMonth.replace("{value}", usd(size * pricePerGbMonth));
  const times = Math.floor(copiesGb / oursGb);
  const figure = (text: string) => <span className="text-signal tabular-nums">{text}</span>;

  return (
    <>
      <Head
        id="cost"
        eyebrow={t.cost.label}
        title={
          <>
            {figure(`${Math.round((1 - oursGb / copiesGb) * 100)}%`)} {words.storage} {words.and}{" "}
            {figure(`${times}×`)} {words.cost}.
          </>
        }
        line={fill(t.cost.chartTitle)}
      />
      <Band>
        <FolderTally
          count={agents}
          changes={Math.round(agents * changed)}
          copies={{
            label: c.without,
            detail: fill(c.withoutDetail),
            total: gb(copiesGb),
            price: perMonth(copiesGb),
          }}
          ours={{
            label: c.with,
            detail: fill(c.withDetail),
            total: gb(oursGb),
            price: perMonth(oursGb),
          }}
          gap={c.gap.replace("{x}", String(times))}
        />
      </Band>
    </>
  );
}
