"use client";

import { Layers, Moon, ScanSearch } from "lucide-react";
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
import { useEnvironments } from "@/features/environments/use-environments";
import { envPath } from "@/lib/paths";
import { useEnvironment } from "@/hooks/use-environment";
import { navigate } from "@/components/shell/router";

// ⌘K opens it. `g` then a letter jumps straight to a page, as in Linear.
const PAGES = [{ key: "i", label: "Indexes", icon: ScanSearch }] as const;

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const env = useEnvironment() ?? "default";
  const { resolvedTheme, setTheme } = useTheme();
  const { envs } = useEnvironments();

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
        if (PAGES.some((p) => p.key === event.key)) navigate(envPath(env));
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
        onSelect: () => navigate(envPath(env)),
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
  }, [env, envs, resolvedTheme, setTheme]);

  return (
    <CommandMenuDialog
      open={open}
      onOpenChange={setOpen}
      title="Jump to"
      description="Search pages and environments"
    >
      <Menu items={items} className="max-h-[440px]">
        <CommandMenuInput placeholder="Jump to a page or environment…" />
        <CommandMenuList>
          <CommandMenuEmpty>Nothing matches.</CommandMenuEmpty>
        </CommandMenuList>
      </Menu>
    </CommandMenuDialog>
  );
}
