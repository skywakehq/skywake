"use client";

import { useEffect, useState } from "react";
import { withBase } from "@/lib/zone";

export type Region = { name: string; default: boolean };

export { area, city, place } from "@skywake/ui/lib/regions";

let loaded: Promise<Region[]> | undefined;

/** The regions skywake-api can keep data in. Fetched once per page load. */
export function useRegions() {
  const [regions, setRegions] = useState<Region[]>([]);
  useEffect(() => {
    loaded ??= fetch(withBase("/api/skywake/regions")).then((response) =>
      response.ok ? response.json() : [],
    );
    loaded.then(setRegions, () => setRegions([]));
  }, []);
  return regions;
}
