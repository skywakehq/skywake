import { ArrowRight, ArrowUpRight, Check } from "lucide-react";

import type { HomeMessages } from "@/content/messages";
import { site } from "@/content/site";
import { FolderIcon } from "@/components/ui/folder-icon";
import { Band } from "@/components/ui/frame";
import { ConsoleLink } from "@/components/ui/console-link";
import { Head } from "@/components/ui/statement";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: site.docsUrl, featured: false },
  { href: site.cloudOpen ? site.consoleUrl : "#waitlist", featured: true },
];

/** Pricing while the cloud is in private beta: free self-hosting, and the cloud to come. */
export function Plans({ t }: { t: HomeMessages }) {
  const p = t.plans;
  const options = p.options.map((option, i) => ({ ...option, ...LINKS[i]! }));
  return (
    <>
      <Head as="h1" id="pricing" title={p.title} line={p.line} />
      <Band>
        <ol className="grid gap-4 md:grid-cols-2">
          {options.map((option) => (
            <li
              key={option.name}
              className={cn(
                "panel flex flex-col px-6 py-10 sm:px-10 lg:px-12",
                option.featured && "panel-sun",
              )}
            >
              <p className="t-body flex items-center gap-2.5 font-medium text-foreground">
                {option.featured && <FolderIcon className="h-5 w-auto -rotate-6" />}
                {option.name}
              </p>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="t-num text-foreground">{option.price}</span>
                <span className="t-small text-muted-foreground">{option.per}</span>
              </p>
              <p className="t-body mt-4 text-muted-foreground">{option.line}</p>
              <ul className="mt-8 flex flex-col gap-3">
                {option.includes.map((item) => (
                  <li key={item} className="t-body flex items-start gap-2.5 text-foreground">
                    <Check aria-hidden className="mt-1 size-4 shrink-0 text-signal" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-12">
                {option.featured && site.cloudOpen ? (
                  <ConsoleLink
                    className="btn btn-primary"
                    getStarted={t.nav.getStarted}
                    open={t.nav.open}
                    icon={<ArrowRight className="size-4" />}
                  />
                ) : (
                <a
                  href={option.href}
                  className={`btn ${option.featured ? "btn-primary" : "btn-secondary"}`}
                >
                  {option.action}
                  {option.featured ? (
                    <ArrowRight className="size-4" />
                  ) : (
                    <ArrowUpRight className="size-4" />
                  )}
                </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Band>
    </>
  );
}
