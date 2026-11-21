import type { ReactNode } from "react";

/** A simple-icons path drawn in white. */
export function Brand({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-white">
      <path d={path} />
    </svg>
  );
}

/** A small rounded square in a brand colour, holding a mark. */
export function Badge({ tile, children }: { tile: string; children: ReactNode }) {
  return (
    <span
      className="grid size-7 shrink-0 place-items-center rounded-lg"
      style={{ background: tile }}
    >
      {children}
    </span>
  );
}
