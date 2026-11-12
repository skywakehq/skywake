"use client";

import { useZero, ZeroProvider } from "@rocicorp/zero/react";
import { createContext, type ReactNode, use, useEffect, useSyncExternalStore } from "react";
import { AppShell } from "@skywake/ui/components/app-shell";
import { UploadTray } from "@/features/files/upload-tray";
import { since } from "@/features/usage/usage";
import { mutators } from "@/zero/mutators";
import { queries } from "@/zero/queries";
import { schema } from "@/zero/schema";
import { AppSidebar } from "./app-sidebar";
import { CommandMenu } from "./command-menu";
import { RoleContext } from "./role";
import { TopBar } from "./top-bar";

export type User = { id: string; name: string; email: string };

/** Where browsers reach zero-cache and the API. Read when the server runs, not when it is built. */
export type Urls = { zero: string; api: string };

const UrlsContext = createContext<Urls>({ zero: "", api: "" });
export const useUrls = () => use(UrlsContext);

const subscribe = () => () => {};

export function Console({
  user,
  org,
  role,
  urls,
  sidebarOpen,
  children,
}: {
  user: User;
  org: string;
  /** The person's role in `org`, which decides whether the audit log is read. */
  role: string;
  urls: Urls;
  sidebarOpen: boolean;
  children: ReactNode;
}) {
  // Zero keeps its data in the browser, so nothing is drawn on the server.
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!inBrowser) return null;
  return (
    // A new Zero for each organization and role, so one never shows another's rows.
    <ZeroProvider
      key={`${org}:${role}`}
      userID={user.id}
      storageKey={org}
      context={{ userID: user.id, org, role }}
      cacheURL={urls.zero}
      schema={schema}
      mutators={mutators}
    >
      <Preload />
      <RoleContext value={role}>
        <UrlsContext value={urls}>
          {/* Each view scrolls its own parts. */}
          <AppShell
            sidebar={<AppSidebar />}
            topBar={<TopBar />}
            sidebarOpen={sidebarOpen}
            scroll={false}
          >
            {children}
          </AppShell>
          <CommandMenu />
          <UploadTray />
        </UrlsContext>
      </RoleContext>
    </ZeroProvider>
  );
}

// Every page reads from these, so they are synced as soon as the console opens
// and the first visit to any page is drawn at once.
function Preload() {
  const zero = useZero();
  useEffect(() => {
    const loads = [
      zero.preload(queries.environments()),
      zero.preload(queries.namespaces()),
      zero.preload(queries.orgBranches()),
      zero.preload(queries.orgCommits({ limit: 10_000 })),
      zero.preload(queries.orgSessions()),
      zero.preload(queries.activity({ limit: 1000 })),
      zero.preload(queries.usage({ since: since() })),
    ];
    return () => loads.forEach((load) => load.cleanup());
  }, [zero]);
  return null;
}
