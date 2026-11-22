import type { HomeMessages } from "@/content/messages";
import { useCases } from "@/content/use-cases";
import type { Locale } from "@/lib/i18n";
import { Band } from "@/components/ui/frame";
import { Head } from "@/components/ui/statement";
import { UseCaseList } from "@/components/sections/use-case-page";

/** The library of use case guides: the page's title, then every guide as a folder listing. */
export function UseCaseIndex({ locale, t }: { locale: Locale; t: HomeMessages }) {
  const g = t.guides;
  return (
    <>
      <Head as="h1" title={g.title} line={g.accent} />
      <Band>
        <UseCaseList items={useCases} locale={locale} t={t} columns="md:grid-cols-2" />
      </Band>
    </>
  );
}
