"use client";

import { useEffect, useState } from "react";
import { withBase } from "@/lib/zone";

export type UsedKey = { id: string; name: string; last_used?: string | null };

/** How often to ask while waiting. An agent marks its key used as it starts. */
const EVERY_MS = 1000;

/**
 * The first key that has been used, or only the key `id` when one is given.
 * Asked at once, every second while the tab is in view, and again the moment
 * the tab comes back (from the terminal where the agent was started), until
 * one turns up. Undefined until the first answer, null while none has.
 */
export function useUsedKey({ id, enabled = true }: { id?: string; enabled?: boolean } = {}) {
  const [used, setUsed] = useState<UsedKey | null>();
  const found = !!used;

  useEffect(() => {
    if (!enabled || found) return;
    let live = true;
    let asking = false;
    const ask = () => {
      if (asking || document.hidden) return;
      asking = true;
      fetch(withBase("/api/keys"))
        .then((response) => (response.ok ? response.json() : []))
        .then((keys: UsedKey[]) => {
          const key = keys.find((each) => each.last_used && (!id || each.id === id));
          if (live) setUsed(key ?? null);
        })
        .catch(() => live && setUsed((was) => was ?? null))
        .finally(() => {
          asking = false;
        });
    };
    ask();
    const timer = setInterval(ask, EVERY_MS);
    window.addEventListener("focus", ask);
    document.addEventListener("visibilitychange", ask);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", ask);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [id, enabled, found]);

  return used;
}
