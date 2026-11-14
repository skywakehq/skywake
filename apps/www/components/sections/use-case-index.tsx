import { Container } from "@/components/ui/section";
import { type UseCase, useCases } from "@/content/use-cases";
import { localizePath, type Locale } from "@/lib/i18n";
import { UseCaseCard } from "./use-case-card";

// The first six are the ones shown on the homepage.
const GROUPS = [
  { title: "For AI agents", items: useCases.slice(0, 6), columns: "lg:grid-cols-3" },
  { title: "For builds and data", items: useCases.slice(6), columns: "" },
];

function Cards({ items, locale, columns }: { items: UseCase[]; locale: Locale; columns: string }) {
  return (
    <ul className={`mt-6 grid gap-3 sm:grid-cols-2 ${columns}`}>
      {items.map((item) => (
        <li key={item.id}>
          <UseCaseCard
            id={item.id}
            name={item.name}
            title={item.title}
            line={item.lead}
            href={localizePath(locale, `/use-cases/${item.id}`)}
          />
        </li>
      ))}
    </ul>
  );
}

export function UseCaseIndex({ locale }: { locale: Locale }) {
  return (
    <Container className="pt-20 lg:pt-28">
      <p className="t-eyebrow text-muted-foreground">Use cases</p>
      <h1 className="t-display t-regular mt-5 max-w-[16ch] text-foreground">
        Give every job <span className="text-signal">its own copy of the data.</span>
      </h1>
      <p className="t-lead mt-6 max-w-[46ch] text-muted-foreground">
        Ten ways teams use Skywake. Pick one to see the problem, how it works and the commands to
        try it.
      </p>
      {GROUPS.map((group) => (
        <section key={group.title} className="mt-16 lg:mt-20">
          <h2 className="t-h3 flex items-baseline gap-3 text-foreground">
            {group.title}
            <span className="t-mono text-muted-foreground">{group.items.length}</span>
          </h2>
          <Cards items={group.items} locale={locale} columns={group.columns} />
        </section>
      ))}
    </Container>
  );
}
