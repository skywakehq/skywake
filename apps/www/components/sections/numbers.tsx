import { CrashProof, FreshSearch, MoveDisk, Segments } from "@/components/art/bench-art";
import { Band } from "@/components/ui/frame";
import { Head } from "@/components/ui/statement";
import type { HomeMessages } from "@/content/messages";
import { homeClaims, homeRaces } from "@/content/numbers";

const SCENES = [CrashProof, MoveDisk, FreshSearch];

/** The measured numbers: three claims with a live scene each, then three head-to-head results. */
export function Numbers({ t }: { t: HomeMessages }) {
  const b = t.benchmarks;
  return (
    <>
      <Head id="benchmarks" eyebrow={b.label} title={b.title} line={b.line} />
      <Band>
        <ul className="grid gap-4 lg:grid-cols-3">
          {b.claims.map((claim, i) => {
            const Scene = SCENES[i]!;
            return (
              <li key={claim.title} className="panel reveal flex flex-col p-3">
                <div className="flex h-52 items-center rounded-[1.5rem] bg-foreground/[0.03] p-5">
                  <Scene />
                </div>
                <div className="flex flex-1 flex-col p-5 pt-6">
                  <h3 className="t-h3 text-foreground">{claim.title}</h3>
                  <p className="mt-2 text-muted-foreground">{claim.line}</p>
                  <p className="mt-auto pt-10 text-5xl leading-none font-medium tracking-[-0.05em] text-foreground tabular-nums">
                    {homeClaims[i]}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{claim.label}</p>
                </div>
              </li>
            );
          })}
        </ul>
        <ul className="mt-4 grid gap-4 lg:grid-cols-3">
          {b.races.map((race, i) => {
            const { verdict, bars } = homeRaces[i]!;
            const best = Math.min(...bars.map((bar) => bar.value));
            return (
              <li key={race.title} className="panel reveal flex flex-col p-6 sm:p-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="t-h3 text-foreground">{race.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{race.proof}</p>
                  </div>
                  <p className="text-5xl leading-none font-medium tracking-[-0.05em] text-foreground tabular-nums">
                    {verdict}
                  </p>
                </div>
                <dl className="mt-auto grid gap-4 pt-10">
                  {bars.map((bar, j) => (
                    <div key={race.labels[j]} className="grid gap-2">
                      <div className="flex justify-between gap-4 text-sm">
                        <dt className={bar.lit ? "text-foreground" : "text-muted-foreground"}>
                          {race.labels[j]}
                        </dt>
                        <dd className="font-mono text-muted-foreground tabular-nums">
                          {bar.figure}
                        </dd>
                      </div>
                      <Segments share={best / bar.value} lit={bar.lit} />
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      </Band>
    </>
  );
}
