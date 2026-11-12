"use client";

import { useQuery } from "@rocicorp/zero/react";
import { Activity, FolderOpen, GitBranch, HardDrive, History, Layers, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import {
  CommandMenu as Menu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuInput,
  CommandMenuList,
  type CommandMenuItemData,
} from "@skywake/ui/components/command-menu";
import type { IconComponentProps } from "@skywake/ui/lib/icon-context";
import { envOf, nameInEnv } from "@/lib/names";
import { useEnvironments } from "@/features/environments/use-environments";
import { branchPath, envPath, nsPath } from "@/lib/paths";
import { useEnvironment, useNamespace } from "@/hooks/use-ns";
import { queries } from "@/zero/queries";
import { navigate } from "@/components/shell/router";
import { Orb } from "@/components/kit";

// ⌘K opens it. `g` then a letter jumps straight to a page, as in Linear.
const PAGES = [
  { key: "f", label: "Filesystems", page: undefined, icon: HardDrive },
  { key: "y", label: "Activity", page: "activity", icon: Activity },
] as const;

/** A filesystem's orb, in the shape the menu takes icons. */
function orbIcon(name: string) {
  return function FilesystemOrb({ className }: IconComponentProps) {
    return <Orb name={name} className={className ?? "size-4"} />;
  };
}

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const env = useEnvironment() ?? "default";
  const ns = useNamespace();
  const { resolvedTheme, setTheme } = useTheme();
  const [namespaces] = useQuery(queries.namespaces());
  const { envs } = useEnvironments();
  const [branches] = useQuery(queries.branches({ ns: ns ?? "" }), { enabled: !!ns });

  // ⌘K is the dialog's own shortcut; this adds `g` then a letter.
  useEffect(() => {
    let leader = 0;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      if (event.metaKey || event.ctrlKey) return;
      if (event.key === "g") {
        leader = Date.now();
      } else if (Date.now() - leader < 800) {
        const page = PAGES.find((p) => p.key === event.key);
        if (page) navigate(envPath(env, page.page));
        leader = 0;
      }
    }
    const openMenu = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-menu", openMenu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-menu", openMenu);
    };
  }, [env]);

  const items = useMemo<CommandMenuItemData[]>(() => {
    const dark = resolvedTheme === "dark";
    return [
      ...PAGES.map((page) => ({
        value: `page ${page.label}`,
        label: page.label,
        description: `G ${page.key.toUpperCase()}`,
        icon: page.icon,
        group: `In ${env}`,
        onSelect: () => navigate(envPath(env, page.page)),
      })),
      ...(ns
        ? [
            {
              value: "fs files",
              label: "Files",
              icon: FolderOpen,
              group: nameInEnv(ns),
              onSelect: () => navigate(nsPath(ns)),
            },
            {
              value: "fs branches",
              label: "Branches",
              icon: GitBranch,
              group: nameInEnv(ns),
              onSelect: () => navigate(nsPath(ns, "branches")),
            },
            {
              value: "fs history",
              label: "History",
              icon: History,
              group: nameInEnv(ns),
              onSelect: () => navigate(nsPath(ns, "history")),
            },
            ...branches.map((b) => ({
              value: `branch ${b.name}`,
              label: b.name,
              icon: GitBranch,
              group: nameInEnv(ns),
              onSelect: () => navigate(branchPath(ns, b.name)),
            })),
          ]
        : []),
      ...namespaces.map((n) => ({
        value: `fs ${n.name}`,
        label: nameInEnv(n.name),
        description: envOf(n.name),
        icon: orbIcon(n.name),
        group: "Filesystems",
        onSelect: () => navigate(nsPath(n.name)),
      })),
      ...envs.map((e) => ({
        value: `env ${e.name}`,
        label: e.name,
        icon: Layers,
        group: "Environments",
        onSelect: () => navigate(envPath(e.name)),
      })),
      {
        value: "theme",
        label: `Switch to ${dark ? "light" : "dark"} theme`,
        icon: Moon,
        group: "Preferences",
        onSelect: () => setTheme(dark ? "light" : "dark"),
      },
    ];
  }, [env, ns, branches, namespaces, envs, resolvedTheme, setTheme]);

  return (
    <CommandMenuDialog
      open={open}
      onOpenChange={setOpen}
      title="Jump to"
      description="Search pages, environments, filesystems and branches"
    >
      <Menu items={items} className="max-h-[440px]">
        <CommandMenuInput placeholder="Jump to a page, filesystem or branch…" />
        <CommandMenuList>
          <CommandMenuEmpty>Nothing matches.</CommandMenuEmpty>
        </CommandMenuList>
      </Menu>
    </CommandMenuDialog>
  );
}
