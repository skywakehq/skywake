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
import { Orb } from "@/components/kit";

const PAGES: Record<string, string> = {
  activity: "Activity",
  history: "History",
  usage: "Usage",
  settings: "Settings",
  indexes: "Indexes",
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
  else if (route.view === "index") {
    if (env) trail.push({ label: env, href: envPath(env) });
    trail.push({ label: "Indexes", href: env && envPath(env, "indexes") });
    trail.push({ label: nameInEnv(route.index), mono: true });
  } else {
    if (env) trail.push({ label: env, href: envPath(env) });
    if (ns)
      trail.push({
        label: nameInEnv(ns),
        href: nsPath(ns),
        mono: true,
        lead: <Orb name={ns} className="size-3.5" />,
      });
    if (branch) trail.push({ label: branch, mono: true });
    else if (page) trail.push({ label: page });
    else if (!ns) trail.push({ label: "Filesystems" });
  }
  if (ns && env !== envOf(ns)) trail.shift();

  return (
    <ShellTopBar
      end={
        <ShellSearch
          label="Search or jump to…"
          onClick={() => window.dispatchEvent(new Event("open-command-menu"))}
        />
      }
    >
      <ShellTrail steps={trail} link={Link} />
    </ShellTopBar>
  );
}
