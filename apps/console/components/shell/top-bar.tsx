"use client";

import { Link, useRoute } from "@/components/shell/router";
import { usePathname } from "next/navigation";
import {
  ShellSearch,
  ShellTopBar,
  ShellTrail,
  type TrailStep,
} from "@skywake/ui/components/app-shell";
import { envOf, nameInEnv } from "@/lib/names";
import { envPath, nsPath } from "@/lib/paths";
import { useEnvironment, useNamespace } from "@/hooks/use-ns";
import { DiskMark } from "@/components/kit";

const PAGES: Record<string, string> = {
  activity: "Activity",
  branches: "Branches",
  search: "Search",
  history: "History",
  usage: "Usage",
  settings: "Settings",
};

/** Where you are, as a trail of links. Switching happens in the sidebar. */
export function TopBar() {
  const env = useEnvironment();
  const ns = useNamespace();
  const path = usePathname();
  const route = useRoute();
  const branch = route.view === "branch" ? route.branch : undefined;
  const page = PAGES[path.split("/").at(-1) ?? ""];

  const trail: TrailStep[] = [];
  if (path === "/usage" || path === "/settings") trail.push({ label: page });
  else if (route.view === "cli") trail.push({ label: "Sign in the CLI" });
  else if (route.view === "desktop") trail.push({ label: "Sign in Skywake for Mac" });
  else {
    if (env) trail.push({ label: env, href: envPath(env) });
    if (ns)
      trail.push(
        { label: "Disks", href: env && envPath(env) },
        {
          label: nameInEnv(ns),
          href: nsPath(ns),
          lead: <DiskMark className="h-3.5" />,
        },
      );
    if (branch) trail.push({ label: branch });
    else if (page) trail.push({ label: page });
    else if (!ns) trail.push({ label: "Disks" });
  }
  if (ns && env !== envOf(ns)) trail.shift();

  return (
    <ShellTopBar
      flat
      end={
        <ShellSearch
          flat
          label="Search or jump to…"
          onClick={() => window.dispatchEvent(new Event("open-command-menu"))}
        />
      }
    >
      <ShellTrail steps={trail} link={Link} />
    </ShellTopBar>
  );
}
