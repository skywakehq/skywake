"use client";

import { type ReactNode, useState } from "react";
import { IndexMark, ResourcePage, Rows, plural } from "@/components/kit";
import { city } from "@/features/environments/regions";
import { envOf } from "@/lib/names";
import { indexApi, indexPath } from "@/lib/paths";
import type { IndexTab } from "@/lib/routes";
import { type IndexBranch, type IndexInfo, indexUrl, useApi } from "./api";
import { Branches } from "./branches";
import { Select } from "./fields";
import { Overview } from "./overview";
import { QueryPlayground } from "./query-playground";
import { IndexRows } from "./rows";
import { IndexSettings } from "./settings";

const TABS: { tab: IndexTab; label: string }[] = [
  { tab: "overview", label: "Overview" },
  { tab: "query", label: "Query" },
  { tab: "rows", label: "Rows" },
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
  const picksBranch = tab === "overview" || tab === "query" || tab === "rows";

  const facts: ReactNode[] = [envOf(index)];
  if (region) facts.push(<span title={region}>{city(region)}</span>);
  if (names.length) facts.push(plural(names.length, "branch"));

  return (
    <ResourcePage
      name={index}
      mark={<IndexMark name={index} className="size-10" />}
      facts={facts}
      actions={
        picksBranch &&
        names.length > 1 && (
          <Select
            aria-label="Branch"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            className="text-xs"
          >
            {names.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </Select>
        )
      }
      tabs={TABS.map((item) => ({
        href: indexPath(index, item.tab),
        label: item.label,
        active: item.tab === tab,
      }))}
    >
      {info.loaded.state === "loading" ? (
        <Rows count={4} />
      ) : info.loaded.state === "failed" ? (
        <p className="text-sm text-destructive">{info.loaded.error}</p>
      ) : tab === "overview" ? (
        <Overview index={info.loaded.value} branch={branch} />
      ) : tab === "query" ? (
        <QueryPlayground index={info.loaded.value} branch={branch} />
      ) : tab === "rows" ? (
        <IndexRows index={info.loaded.value} branch={branch} />
      ) : tab === "branches" ? (
        <Branches index={index} branches={branches} onPick={setBranch} />
      ) : (
        <IndexSettings index={info.loaded.value} onChange={info.reload} />
      )}
    </ResourcePage>
  );
}
