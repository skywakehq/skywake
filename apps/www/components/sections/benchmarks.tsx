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
import { getMessages, type HomeMessages } from "@/content/messages";
import { files, headline, search, type StatGroup, type StatIcon } from "@/content/numbers";
import { defaultLocale, localizePath, type Locale } from "@/lib/i18n";

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

function GroupCard({
  group,
  seeAll,
  locale,
}: {
  group: StatGroup;
  seeAll: string;
  locale: Locale;
}) {
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
          href={localizePath(locale, group.href)}
          className="t-small group mt-4 inline-flex w-fit items-center gap-1.5 text-foreground"
        >
          {seeAll}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

export function Benchmarks({
  show = "all",
  locale = defaultLocale,
  messages,
}: {
  show?: "all" | "files" | "search";
  locale?: Locale;
  messages?: HomeMessages;
}) {
  const t = messages ?? getMessages(locale);

  const groups =
    show === "all"
      ? headline.map((group, i) => ({
          ...group,
          claim: t.benchmarks.groups[i]?.claim ?? group.claim,
          line: t.benchmarks.groups[i]?.line ?? group.line,
        }))
      : show === "files"
        ? files.groups
        : search.groups;

  const note = show === "files" ? files.setup : show === "search" ? search.setup : undefined;

  return (
    <Section
      id="benchmarks"
      label={t.benchmarks.label}
      title={t.benchmarks.title}
      line={t.benchmarks.line}
    >
      <Container className="grid gap-3 lg:grid-cols-2">
        {groups.map((group) => (
          <GroupCard
            key={group.claim}
            group={group}
            seeAll={t.benchmarks.seeAll}
            locale={locale}
          />
        ))}
      </Container>
      {note && <Container className="t-mono pt-4 text-muted-foreground">{note}.</Container>}
    </Section>
  );
}
