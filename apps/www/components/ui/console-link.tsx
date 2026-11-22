"use client";

import { type ReactNode, useEffect, useState } from "react";

import { site } from "@/content/site";

const KEY = "skywake:signed-in";

/**
 * Whether this visitor is signed in to the console. The console is a zone on
 * the same domain, so its session cookie comes along on a same-origin request
 * to its auth API. The cookie itself is httpOnly, so asking is the only way to
 * know. The answer is kept for the tab's life so later pages don't flash.
 */
function useSignedIn() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const base = site.consoleUrl;
    // A console on another domain can't see this site's cookies; leave the button as it is.
    if (!site.cloudOpen || !base?.startsWith("/")) return;
    try {
      if (sessionStorage.getItem(KEY) === "1") setSignedIn(true);
    } catch {}
    const abort = new AbortController();
    fetch(`${base.replace(/\/$/, "")}/api/auth/get-session`, {
      credentials: "same-origin",
      signal: abort.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { session?: unknown } | null) => {
        const yes = Boolean(body?.session);
        setSignedIn(yes);
        try {
          sessionStorage.setItem(KEY, yes ? "1" : "0");
        } catch {}
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  return signedIn;
}

/** A link into the console that reads "Get started", or "Open" once the visitor is signed in. */
export function ConsoleLink({
  className,
  getStarted,
  open,
  icon,
}: {
  className?: string;
  getStarted: string;
  open: string;
  icon?: ReactNode;
}) {
  const signedIn = useSignedIn();
  return (
    <a href={site.consoleUrl} className={className}>
      {signedIn ? open : getStarted}
      {icon}
    </a>
  );
}
