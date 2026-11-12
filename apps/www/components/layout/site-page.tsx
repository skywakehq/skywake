import type { ReactNode } from "react";

import { Footer } from "./footer";
import { Nav } from "./nav";

export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-x-clip [counter-reset:section]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-full max-w-6xl -translate-x-1/2 border-x border-border"
      />
      <Nav />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
