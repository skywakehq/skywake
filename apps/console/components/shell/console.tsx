"use client";

import { useZero, ZeroProvider } from "@rocicorp/zero/react";
import { createContext, type ReactNode, use, useEffect, useSyncExternalStore } from "react";
import { AppShell } from "@skywake/ui/components/app-shell";
import { mutators } from "@/zero/mutators";
import { queries } from "@/zero/queries";
import { schema } from "@/zero/schema";
import { AppSidebar } from "./app-sidebar";
import { CommandMenu } from "./command-menu";
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
  urls,
  sidebarOpen,
  children,
}: {
  user: User;
  org: string;
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
    // A new Zero for each organization, so one never shows another's rows.
    <ZeroProvider
      key={org}
      userID={user.id}
      storageKey={org}
      context={{ userID: user.id, org }}
      cacheURL={urls.zero}
      schema={schema}
      mutators={mutators}
    >
      <Preload />
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
      </UrlsContext>
    </ZeroProvider>
  );
}

// Every page reads the environments, so they are synced as soon as the console
// opens and the first visit to any page is drawn at once.
function Preload() {
  const zero = useZero();
  useEffect(() => {
    const load = zero.preload(queries.environments());
    return () => load.cleanup();
  }, [zero]);
  return null;
}
