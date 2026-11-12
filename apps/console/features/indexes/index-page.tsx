"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Link } from "@/components/shell/router";
import { Rows } from "@/components/kit";
import { city } from "@/features/environments/regions";
import { envOf, nameInEnv } from "@/lib/names";
import { indexApi, indexPath } from "@/lib/paths";
import type { IndexTab } from "@/lib/routes";
import { cn } from "@skywake/ui/lib/utils";
import { type IndexBranch, type IndexInfo, indexUrl, useApi } from "./api";
import { Branches } from "./branches";
import { Documents } from "./documents";
import { Select } from "./fields";
import { Overview } from "./overview";
import { QueryPlayground } from "./query-playground";
import { IndexSettings } from "./settings";

const TABS: { tab: IndexTab; label: string }[] = [
  { tab: "overview", label: "Overview" },
  { tab: "query", label: "Query" },
  { tab: "documents", label: "Documents" },
  { tab: "branches", label: "Branches" },
  { tab: "settings", label: "Settings" },
];

/** A search index: its name, a branch to look at, the tabs, then the tab. */
export function IndexPage({ index, tab }: { index: string; tab: IndexTab }) {
  const info = useApi<IndexInfo>(indexUrl(index));
  const branches = useApi<IndexBranch[]>(indexApi(index, "branches"));
  const [branch, setBranch] = useState("main");
  const names = branches.loaded.state === "done" ? branches.loaded.value.map((b) => b.name) : [];
  const region = info.loaded.state === "done" ? info.loaded.value.region : undefined;
  const picksBranch = tab === "overview" || tab === "query" || tab === "documents";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-8 px-8 pt-10 pb-16 max-sm:px-4 max-sm:pt-6">
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0">
              <h1 className="truncate font-mono text-[26px] leading-8 font-semibold tracking-[-0.02em]">
                {nameInEnv(index)}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {envOf(index)}
                {region && (
                  <>
                    {" "}
                    <span className="text-faint">·</span> <span title={region}>{city(region)}</span>
                  </>
                )}{" "}
                <span className="text-faint">· index</span>
              </p>
            </div>
            {picksBranch && names.length > 1 && (
              <Select
                aria-label="Branch"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                className="ml-auto font-mono"
              >
                {names.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </Select>
            )}
          </div>
          <nav className="flex items-center gap-1 overflow-x-auto border-b">
            {TABS.map((item) => {
              const active = item.tab === tab;
              return (
                <Link
                  key={item.tab}
                  href={indexPath(index, item.tab)}
                  className={cn(
                    "relative px-3 pb-3 text-sm transition-colors",
                    active
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                  {active && (
                    <motion.span
                      layoutId={`index-tab-${index}`}
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      className="absolute inset-x-1.5 -bottom-px h-0.5 bg-foreground"
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {info.loaded.state === "loading" ? (
          <Rows count={4} />
        ) : info.loaded.state === "failed" ? (
          <p className="text-sm text-destructive">{info.loaded.error}</p>
        ) : tab === "overview" ? (
          <Overview index={info.loaded.value} branch={branch} />
        ) : tab === "query" ? (
          <QueryPlayground index={info.loaded.value} branch={branch} />
        ) : tab === "documents" ? (
          <Documents index={info.loaded.value} branch={branch} />
        ) : tab === "branches" ? (
          <Branches index={index} branches={branches} onPick={setBranch} />
        ) : (
          <IndexSettings index={info.loaded.value} onChange={info.reload} />
        )}
      </div>
    </div>
  );
}
