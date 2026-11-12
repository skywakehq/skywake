import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { CARD, Container, Section } from "@/components/ui/section";
import { files, headline, search, type StatGroup } from "@/content/numbers";

function GroupCard({ group }: { group: StatGroup }) {
  return (
    <div className={`${CARD} flex flex-col p-6 sm:p-8`}>
      <h3 className="t-h3 text-foreground">{group.claim}</h3>
      <p className="t-body mt-1.5 text-muted-foreground">{group.line}</p>
      <dl className="mt-auto pt-8">
        {group.stats.map((stat) => (
          <div
            key={stat.label}
            className="flex items-baseline justify-between gap-6 border-t border-border py-3.5"
          >
            <dt className="t-mono text-muted-foreground">{stat.label}</dt>
            <dd className="t-h3 text-signal tabular-nums">{stat.figure}</dd>
          </div>
        ))}
      </dl>
      {group.href && (
        <Link
          href={group.href}
          className="t-small group mt-4 inline-flex w-fit items-center gap-1.5 text-foreground"
        >
          See all benchmarks
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

const SETS = {
  all: { groups: headline, note: undefined },
  files: { groups: files.groups, note: files.setup },
  search: { groups: search.groups, note: search.setup },
};

export function Benchmarks({ show = "all" }: { show?: keyof typeof SETS }) {
  const { groups, note } = SETS[show];
  return (
    <Section id="benchmarks" label="Benchmarks" title="Local speed, straight from your bucket.">
      <Container className="grid gap-3 lg:grid-cols-2">
        {groups.map((group) => (
          <GroupCard key={group.claim} group={group} />
        ))}
      </Container>
      {note && <Container className="t-mono pt-4 text-muted-foreground">{note}.</Container>}
    </Section>
  );
}
