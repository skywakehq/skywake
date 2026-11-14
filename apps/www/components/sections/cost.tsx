import { StorageBars } from "@/components/art/storage-bars";
import { CARD, Container, Section } from "@/components/ui/section";
import { getMessages, type HomeMessages } from "@/content/messages";
import { costExample } from "@/content/pricing";
import { defaultLocale, type Locale } from "@/lib/i18n";

const { agents, workspaceGb, changed, copyMbPerSecond, forkSeconds, pricePerGbMonth } = costExample;

const copiesGb = agents * workspaceGb;
const forksGb = workspaceGb + agents * workspaceGb * changed;

// Fills {agents}, {saved} and the other example numbers into a message.
const numbers: Record<string, string> = {
  agents: String(agents),
  workspaceGb: String(workspaceGb),
  changed: String(changed * 100),
  saved: String(Math.round((1 - forksGb / copiesGb) * 100)),
  addedMb: String(Math.round((workspaceGb * changed * 1024) / 10) * 10),
};
const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, key: string) => numbers[key] ?? m);

const gb = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} TB` : `${Math.round(n)} GB`);
const usd = (n: number) => (n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`);
const time = (s: number) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${Math.round(s / 60)} min`);

export function Cost({
  locale = defaultLocale,
  messages,
}: {
  locale?: Locale;
  messages?: HomeMessages;
}) {
  const t = messages ?? getMessages(locale);
  const c = t.cost.chart;
  const perMonth = (gb: number) => c.perMonth.replace("{value}", usd(gb * pricePerGbMonth));
  const comparisons = [
    {
      label: t.cost.storageMonth,
      ours: usd(forksGb * pricePerGbMonth),
      theirs: usd(copiesGb * pricePerGbMonth),
    },
    {
      label: t.cost.beforeAgent,
      ours: time(forkSeconds),
      theirs: time((workspaceGb * 1024) / copyMbPerSecond),
    },
  ];

  return (
    <Section id="cost" label={t.cost.label} title={fill(t.cost.title)} line={t.cost.line}>
      <Container>
        <div
          className={`${CARD} reveal grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]`}
        >
          <div className="flex flex-col p-6 sm:p-8">
            <p className="t-mono text-muted-foreground">{fill(t.cost.setup)}</p>
            <p className="t-stat mt-8 text-signal">{Math.round(copiesGb / forksGb)}×</p>
            <p className="t-body mt-3 max-w-[24ch] text-foreground">{t.cost.lessStorage}</p>
            <dl className="mt-auto pt-10">
              {comparisons.map((row) => (
                <div key={row.label} className="border-t border-border py-4">
                  <dt className="t-mono text-muted-foreground">{row.label}</dt>
                  <dd className="mt-1 flex items-baseline gap-3">
                    <span className="t-h3 text-foreground tabular-nums">{row.ours}</span>
                    <span className="t-mono text-muted-foreground tabular-nums">
                      {t.cost.vsCopies.replace("{value}", row.theirs)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-col justify-center border-t border-border p-4 sm:p-6 lg:border-t-0 lg:border-l">
            <p className="t-body px-5 font-medium text-foreground">{fill(t.cost.chartTitle)}</p>
            <div className="mt-2">
              <StorageBars
                count={agents}
                copies={{
                  label: c.without,
                  detail: fill(c.withoutDetail),
                  total: gb(copiesGb),
                  price: perMonth(copiesGb),
                }}
                ours={{
                  label: c.with,
                  detail: fill(c.withDetail),
                  total: gb(forksGb),
                  price: perMonth(forksGb),
                }}
                sharedShare={workspaceGb / copiesGb}
                changesShare={(forksGb - workspaceGb) / copiesGb}
                gap={c.gap.replace("{x}", String(Math.round(copiesGb / forksGb)))}
              />
            </div>
          </div>
        </div>

        <h3 className="t-h3 mt-16 text-foreground">{t.cost.howTitle}</h3>
        <ol className="mt-5 grid gap-3 md:grid-cols-3">
          {t.cost.steps.map((step, i) => (
            <li key={step.title} className="reveal rounded-2xl bg-(--soft) p-5">
              <p className="t-mono text-signal">{String(i + 1).padStart(2, "0")}</p>
              <p className="t-body mt-3 font-medium text-foreground">{step.title}</p>
              <p className="t-small mt-1 text-muted-foreground">{fill(step.line)}</p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
