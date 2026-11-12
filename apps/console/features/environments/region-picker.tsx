"use client";

import { cn } from "@skywake/ui/lib/utils";
import { city, type Region } from "@/features/environments/regions";

/** The region a new filesystem or index starts with: the server's default, else the first. */
export function defaultRegion(regions: Region[]) {
  return (regions.find((r) => r.default) ?? regions[0])?.name;
}

/** A list of the server's regions to pick one from. */
export function RegionPicker({
  regions,
  value,
  onChange,
}: {
  regions: Region[];
  value: string | undefined;
  onChange: (region: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Region" className="grid max-h-56 overflow-y-auto">
      {regions.length === 0 && <div className="rounded-md h-8 animate-pulse bg-muted/50" />}
      {regions.map((r) => (
        <button
          key={r.name}
          type="button"
          role="radio"
          aria-checked={r.name === value}
          onClick={() => onChange(r.name)}
          className={cn(
            "rounded-md flex h-8 items-center gap-2.5 px-2.5 text-left text-sm transition-colors",
            r.name === value ? "bg-selected" : "hover:bg-hover",
          )}
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              r.name === value ? "bg-signal" : "bg-faint",
            )}
          />
          <span className="min-w-0 flex-1 truncate">{city(r.name)}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{r.name}</span>
        </button>
      ))}
    </div>
  );
}
