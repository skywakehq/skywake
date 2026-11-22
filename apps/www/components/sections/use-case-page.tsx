import { ArrowRight } from "lucide-react";
import Link from "next/link";

import type { HomeMessages } from "@/content/messages";
import { findUseCase, type UseCase } from "@/content/use-cases";
import { localizePath, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Band } from "@/components/ui/frame";
import { Head } from "@/components/ui/statement";
import { FolderIcon } from "@/components/ui/folder-icon";

export function UseCaseRelated({
  useCase,
  locale,
  t,
}: {
  useCase: UseCase;
  locale: Locale;
  t: HomeMessages;
}) {
  const related = useCase.related.map(findUseCase).filter((item) => item !== undefined);
  const r = t.guides.related;
  return (
    <>
      <Head
        id="related"
        title={r.title}
        action={
          <Link href={localizePath(locale, "/use-cases")} className="btn btn-sm btn-secondary">
            {r.all} <ArrowRight className="size-3.5" />
          </Link>
        }
      />
      <Band>
        <UseCaseList items={related} locale={locale} t={t} columns="md:grid-cols-3" />
      </Band>
    </>
  );
}

/** Use cases as a folder listing. Each row is one link to its guide. */
export function UseCaseList({
  items,
  locale,
  t,
  columns,
}: {
  items: UseCase[];
  locale: Locale;
  t: HomeMessages;
  columns: string;
}) {
  return (
    <ul className={cn("grid gap-3", columns)}>
      {items.map((item) => {
        const copy = t.guides.items[item.id]!;
        return (
          <li key={item.id} className="flex">
            <Link
              href={localizePath(locale, `/use-cases/${item.id}`)}
              className="panel reveal group flex w-full items-center gap-4 p-5 transition-colors hover:bg-(--panel-hover) sm:gap-5 sm:p-6"
            >
              <FolderIcon className="w-11 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-medium tracking-[-0.02em] text-foreground">
                  {copy.name}
                </span>
                <span className="mt-0.5 block text-sm text-pretty text-muted-foreground">
                  {copy.title}
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
