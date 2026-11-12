"use client";

import Link from "fumadocs-core/link";
import type * as PageTree from "fumadocs-core/page-tree";
import { ChevronRight, Moon, Sun } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@skywake/ui/components/collapsible";
import { Logo } from "@skywake/ui/components/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@skywake/ui/components/sidebar";

/** Every page, as the console lists its views: a group per section, folders that fold. */
export function DocsSidebar({ tree }: { tree: PageTree.Root }) {
  const path = usePathname();
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [path, setOpenMobile]);

  // Pages at the top share one group; each top folder is its own.
  const groups: { label?: ReactNode; nodes: PageTree.Node[] }[] = [];
  for (const node of withIndex(tree)) {
    if (node.type === "folder") {
      groups.push({ label: node.name, nodes: withIndex(node) });
    } else if (node.type === "separator") {
      groups.push({ label: node.name, nodes: [] });
    } else if (groups.at(-1) && !groups.at(-1)!.label) {
      groups.at(-1)!.nodes.push(node);
    } else {
      groups.push({ nodes: [node] });
    }
  }

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Logo className="size-4" />
                </span>
                <span className="font-medium">Skywake</span>
                <span className="text-muted-foreground">Docs</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group, i) => (
          <SidebarGroup key={i}>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarMenu>
              {group.nodes.map((node, j) => (
                <Entry key={j} node={node} path={path} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <ThemeItem />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

const MUTED_ICON = "[&>svg]:text-muted-foreground hover:[&>svg]:text-foreground";

const ACTIVE =
  "font-medium text-sidebar-accent-foreground bg-sidebar-accent shadow-[inset_0_0_0_1px_var(--sidebar-border)]";

function Entry({ node, path }: { node: PageTree.Node; path: string }) {
  if (node.type === "separator") return null;
  if (node.type === "page") {
    const active = node.url === path;
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={active} className={active ? ACTIVE : MUTED_ICON}>
          <Link href={node.url}>
            {node.icon ?? <Dot />}
            <span className="truncate">{node.name}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }
  return (
    <Collapsible asChild defaultOpen={holds(node, path)} className="group/folder">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton className={MUTED_ICON}>
            {node.icon ?? node.index?.icon ?? <Dot />}
            <span className="truncate">{node.name}</span>
            <ChevronRight className="ml-auto size-3.5 text-muted-foreground transition-transform group-data-[state=open]/folder:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="mr-0 pr-0">
            {withIndex(node).map((child, i) => (
              <SubEntry key={i} node={child} path={path} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function SubEntry({ node, path }: { node: PageTree.Node; path: string }) {
  if (node.type === "separator") return null;
  if (node.type === "folder") {
    return (
      <Collapsible asChild defaultOpen={holds(node, path)} className="group/sub">
        <SidebarMenuSubItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuSubButton className="cursor-pointer">
              <span className="truncate">{node.name}</span>
              <ChevronRight className="ml-auto size-3.5 text-muted-foreground transition-transform group-data-[state=open]/sub:rotate-90" />
            </SidebarMenuSubButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub className="mr-0 pr-0">
              {withIndex(node).map((child, i) => (
                <SubEntry key={i} node={child} path={path} />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuSubItem>
      </Collapsible>
    );
  }
  const active = node.url === path;
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={active} className={active ? ACTIVE : ""}>
        <Link href={node.url}>
          <span className="truncate">{node.name}</span>
        </Link>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

/** Holds an icon's place for a page without one, so names line up. */
function Dot() {
  return <span aria-hidden className="size-4 shrink-0" />;
}

/**
 * A folder's pages, its index first as "Overview": the folder's name is
 * already right above it. The home page too, under the logo.
 */
function withIndex(folder: PageTree.Folder | PageTree.Root): PageTree.Node[] {
  const overview = (page: PageTree.Item): PageTree.Item => ({ ...page, name: "Overview" });
  const children = folder.children.map((node) =>
    node.type === "page" && node.url === "/" ? overview(node) : node,
  );
  return "index" in folder && folder.index ? [overview(folder.index), ...children] : children;
}

/** Whether the folder holds the page at `path`, so it starts open. */
function holds(folder: PageTree.Folder, path: string): boolean {
  if (folder.index?.url === path) return true;
  return folder.children.some((child) =>
    child.type === "page" ? child.url === path : child.type === "folder" && holds(child, path),
  );
}

function ThemeItem() {
  const { resolvedTheme, setTheme } = useTheme();
  // Drawn by CSS, so the server's guess at the theme never shows.
  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
        <Moon className="dark:hidden" />
        <Sun className="hidden dark:block" />
        <span className="dark:hidden">Dark theme</span>
        <span className="hidden dark:inline">Light theme</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
