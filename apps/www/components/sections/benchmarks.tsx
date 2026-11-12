import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  CloudUpload,
  Download,
  Flame,
  Funnel,
  GitBranch,
  GitFork,
  Hammer,
  MemoryStick,
  Package,
  PenLine,
  ShieldCheck,
  Snowflake,
  Target,
  Zap,
} from "lucide-react";

import { CARD, Container, Section } from "@/components/ui/section";
import { files, headline, search, type StatGroup, type StatIcon } from "@/content/numbers";

const ICONS: Record<StatIcon, typeof Zap> = {
  fork: GitFork,
  branch: GitBranch,
  write: PenLine,
  read: BookOpen,
  package: Package,
  build: Hammer,
  safe: ShieldCheck,
  failover: ArrowLeftRight,
  memory: MemoryStick,
  upload: CloudUpload,
  cold: Snowflake,
  warm: Flame,
  filter: Funnel,
  target: Target,
  fresh: Zap,
  load: Download,
};

function GroupCard({ group }: { group: StatGroup }) {
  return (
    <div className={`${CARD} flex flex-col p-6 sm:p-8`}>
      <h3 className="t-h3 text-foreground">{group.claim}</h3>
      <p className="t-body mt-1.5 text-muted-foreground">{group.line}</p>
      <dl className="mt-auto pt-8">
        {group.stats.map((stat) => {
          const Icon = ICONS[stat.icon];
          return (
            <div key={stat.label} className="flex items-center gap-3 border-t border-border py-4">
              <dt className="t-body flex items-center gap-3 text-muted-foreground">
                <Icon className="size-4 shrink-0" />
                {stat.label}
              </dt>
              <dd className="t-h3 ml-auto text-signal tabular-nums">{stat.figure}</dd>
            </div>
          );
        })}
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
