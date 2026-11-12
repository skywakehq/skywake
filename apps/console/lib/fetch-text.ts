"use client";

import { useEffect, useState } from "react";

export type Loaded<T> =
  { state: "loading" } | { state: "done"; value: T } | { state: "failed"; error: string };

/** Fetches a URL from the console's proxy; null skips it. */
export function useFetch<T>(
  url: string | null,
  parse: (response: Response) => Promise<T>,
): Loaded<T> {
  const [result, setResult] = useState<{ url: string; loaded: Loaded<T> } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    fetch(url)
      .then(async (response) => {
        if (!response.ok)
          throw new Error((await response.json().catch(() => null))?.error ?? response.statusText);
        return parse(response);
      })
      .then(
        (value) => live && setResult({ url, loaded: { state: "done", value } }),
        (error: Error) =>
          live && setResult({ url, loaded: { state: "failed", error: error.message } }),
      );
    return () => {
      live = false;
    };
  }, [url, parse]);
  return result?.url === url ? result.loaded : { state: "loading" };
}

export const asText = (response: Response) => response.text();
export const asJSON = (response: Response) => response.json();
