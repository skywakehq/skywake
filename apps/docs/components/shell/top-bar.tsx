"use client";

import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";
import Link from "fumadocs-core/link";
import type * as PageTree from "fumadocs-core/page-tree";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { usePathname } from "next/navigation";
import { ShellSearch, ShellTopBar, ShellTrail } from "@skywake/ui/components/app-shell";

/** Where you are, as a trail, and search. As in the console. */
export function TopBar({ tree }: { tree: PageTree.Root }) {
  const path = usePathname();
  const { setOpenSearch } = useSearchContext();
  const steps = getBreadcrumbItems(path, tree, { includePage: true }).map((item) => ({
    label: item.name,
    href: item.url,
  }));
  return (
    <ShellTopBar end={<ShellSearch label="Search the docs…" onClick={() => setOpenSearch(true)} />}>
      <ShellTrail steps={steps} link={Link} />
    </ShellTopBar>
  );
}
