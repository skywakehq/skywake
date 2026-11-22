import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { UseCaseScroller } from "@/components/art/use-case-scroller";
import { UseCaseScene } from "@/components/art/use-case-scenes";
import { Band, Title } from "@/components/ui/frame";
import { Head } from "@/components/ui/statement";
import type { HomeMessages } from "@/content/messages";
import { localizePath, type Locale } from "@/lib/i18n";

const IDS = ["knowledge-base", "context-layer", "sandboxes", "coding-agents", "rl"];

export function UseCases({ t, locale }: { t: HomeMessages; locale: Locale }) {
  const u = t.useCases;
  const href = localizePath(locale, "/use-cases");
  return (
    <Band id="use-cases" className="pt-16 sm:pt-24 lg:pt-36">
      <UseCaseScroller
        head={
          <Head
            className="pt-0 pb-8 lg:pt-0 lg:pb-10"
            line={u.line}
            title={<Title before={u.heading[0]} accent={u.heading[1]} />}
          />
        }
        more={
          <Link
            href={href}
            className="t-small inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            {u.more} <ArrowRight className="size-3.5" />
          </Link>
        }
        cta={u.cta}
        items={u.items.map((item, i) => {
          return {
            key: IDS[i]!,
            name: item.name,
            title: item.title,
            href: `${href}/${IDS[i]}`,
            picture: <UseCaseScene index={i} />,
          };
        })}
      />
    </Band>
  );
}
