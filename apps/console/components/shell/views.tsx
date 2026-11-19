"use client";

import { CliLogin } from "@/features/cli/cli-login";
import { Home } from "@/features/environments/home";
import { IndexPage } from "@/features/indexes/index-page";
import { Indexes } from "@/features/indexes/indexes";
import { SettingsPage } from "@/features/settings/settings";
import { useRoute } from "./router";

/** The page for the current address. */
export function Views() {
  const route = useRoute();
  switch (route.view) {
    case "home":
      return <Home />;
    case "settings":
      return <SettingsPage />;
    case "cli":
      return <CliLogin key={route.code} code={route.code} />;
    case "indexes":
      return <Indexes key={route.env} env={route.env} />;
    case "index":
      return <IndexPage key={route.index} index={route.index} tab={route.tab} />;
    case "missing":
      return <p className="p-6 text-sm text-muted-foreground">There is no page here.</p>;
  }
}
