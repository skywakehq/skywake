"use client";

import type * as PageTree from "fumadocs-core/page-tree";
import type { ReactNode } from "react";
import { AppShell } from "@skywake/ui/components/app-shell";
import { DocsSidebar } from "./docs-sidebar";
import { TopBar } from "./top-bar";

/** The console's shell: a sidebar of every page, a top bar, and the page scrolling beside them. */
export function DocsShell({ tree, children }: { tree: PageTree.Root; children: ReactNode }) {
  return (
    <AppShell sidebar={<DocsSidebar tree={tree} />} topBar={<TopBar tree={tree} />}>
      {children}
    </AppShell>
  );
}
