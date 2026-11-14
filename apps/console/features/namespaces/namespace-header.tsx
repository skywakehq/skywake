"use client";

import { useQuery } from "@rocicorp/zero/react";
import { GitFork } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Link, useRoute } from "@/components/shell/router";
import { envOf, nameInEnv } from "@/lib/names";
import { nsPath } from "@/lib/paths";
import { cn } from "@skywake/ui/lib/utils";
import { Button, Hash, Orb, plural } from "@/components/kit";
import { city } from "@/features/environments/regions";
import { queries } from "@/zero/queries";

/** A filesystem's pages: its name, its main branch, two views, then the view. */
export function NamespacePage({
  ns,
  main,
  head,
  commits,
  onFork,
  tools,
  children,
}: {
  ns: string;
  main?: string;
  head?: string | null;
  commits: number;
  onFork?: () => void;
  tools?: ReactNode;
  children: ReactNode;
}) {
  const { view } = useRoute();
  const [namespaces] = useQuery(queries.namespaces());
  const region = namespaces.find((n) => n.name === ns)?.region;
  const tabs = [
    { href: nsPath(ns), label: "Files", view: "files" },
    { href: nsPath(ns, "branches"), label: "Branches", view: "branches" },
    { href: nsPath(ns, "history"), label: "History", view: "history" },
    { href: nsPath(ns, "search"), label: "Search", view: "search" },
  ];
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-8 px-8 pt-10 pb-16 max-sm:px-4 max-sm:pt-6">
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-4">
            <Orb name={ns} className="size-12" />
            <div className="min-w-0">
              <h1 className="truncate font-mono text-[26px] leading-8 font-semibold tracking-[-0.02em]">
                {nameInEnv(ns)}
              </h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span>{envOf(ns)}</span>
                {region && (
                  <>
                    <span className="text-faint">·</span>
                    <span title={region}>{city(region)}</span>
                  </>
                )}
                {main ? (
                  <>
                    <span className="text-faint">·</span>
                    <span className="font-mono text-foreground">{main}</span>
                    <Hash value={head} />
                    <span className="text-faint">·</span>
                    <span className="tabular-nums">{plural(commits, "commit")}</span>
                  </>
                ) : (
                  <span className="text-faint">· no branches yet</span>
                )}
              </p>
            </div>
            {main && onFork && (
              <Button
                variant="primary"
                size="default"
                className="ml-auto"
                onClick={onFork}
                leadingIcon={GitFork}
              >
                Fork {main}
              </Button>
            )}
          </div>
          <nav className="flex items-center gap-1 border-b">
            {tabs.map((tab) => {
              const active = view === tab.view;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "relative px-3 pb-3 text-sm transition-colors",
                    active
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                  {active && (
                    <motion.span
                      layoutId={`fs-tab-${ns}`}
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      className="absolute inset-x-1.5 -bottom-px h-0.5 bg-foreground"
                    />
                  )}
                </Link>
              );
            })}
            <div className="ml-auto flex items-center gap-2 pb-2">{tools}</div>
          </nav>
        </div>
        {children}
      </div>
    </div>
  );
}
