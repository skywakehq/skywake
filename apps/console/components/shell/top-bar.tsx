"use client";

import { Link, useRoute } from "@/components/shell/router";
import {
  ShellSearch,
  ShellTopBar,
  ShellTrail,
  type TrailStep,
} from "@skywake/ui/components/app-shell";
import { nameInEnv } from "@/lib/names";
import { envPath } from "@/lib/paths";
import { useEnvironment } from "@/hooks/use-environment";
import { IndexMark } from "@/components/kit";

/** Where you are, as a trail of links. Switching happens in the sidebar. */
export function TopBar() {
  const env = useEnvironment();
  const route = useRoute();

  const trail: TrailStep[] = [];
  if (route.view === "settings") trail.push({ label: "Settings" });
  else if (route.view === "cli") trail.push({ label: "Sign in the CLI" });
  else if (route.view === "index") {
    if (env) trail.push({ label: env, href: envPath(env) });
    trail.push({ label: "Indexes", href: env && envPath(env) });
    trail.push({
      label: nameInEnv(route.index),
      lead: <IndexMark name={route.index} className="size-3.5" />,
    });
  } else if (route.view === "indexes") {
    trail.push({ label: route.env, href: envPath(route.env) }, { label: "Indexes" });
  }

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
