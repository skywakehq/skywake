"use client";

import { Activity } from "@/features/activity/activity";
import { BranchView } from "@/features/branches/branch-view";
import { Branches } from "@/features/branches/branches";
import { Files } from "@/features/files/files";
import { History } from "@/features/namespaces/history";
import { Namespaces } from "@/features/namespaces/namespaces";
import { Home } from "@/features/environments/home";
import { IndexPage } from "@/features/indexes/index-page";
import { Indexes } from "@/features/indexes/indexes";
import { SettingsPage } from "@/features/settings/settings";
import { Usage } from "@/features/usage/usage";
import { useRoute } from "./router";

/** The page for the current address. */
export function Views() {
  const route = useRoute();
  switch (route.view) {
    case "home":
      return <Home />;
    case "settings":
      return <SettingsPage />;
    case "usage":
      return <Usage />;
    case "filesystems":
      return <Namespaces key={route.env} env={route.env} />;
    case "activity":
      return <Activity key={route.env} env={route.env} />;
    case "indexes":
      return <Indexes key={route.env} env={route.env} />;
    case "index":
      return <IndexPage key={route.index} index={route.index} tab={route.tab} />;
    case "files":
      return <Files key={route.ns} ns={route.ns} />;
    case "branches":
      return <Branches key={route.ns} ns={route.ns} />;
    case "history":
      return <History key={route.ns} ns={route.ns} />;
    case "branch":
      return (
        <BranchView key={`${route.ns}\n${route.branch}`} ns={route.ns} branch={route.branch} />
      );
    case "missing":
      return <p className="p-6 text-sm text-muted-foreground">There is no page here.</p>;
  }
}
