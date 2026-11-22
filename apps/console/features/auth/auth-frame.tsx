import { Geist } from "next/font/google";
import type { ReactNode } from "react";
import { AuthPanel, Wordmark } from "./auth-panel";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

const SITE = "https://skywake.dev";

/**
 * The sign-in pages and the first run, dressed like the landing page: the
 * folder on the left, one form on the right.
 */
export function AuthFrame({ top, children }: { top?: ReactNode; children: ReactNode }) {
  return (
    <div
      className={`${geist.variable} grid min-h-dvh bg-background font-[family-name:var(--font-geist)] antialiased lg:grid-cols-2`}
    >
      <AuthPanel site={SITE} />
      <div className="flex flex-col">
        <header className="flex h-16 items-center justify-between px-5 sm:px-8 lg:justify-end">
          <a href={SITE} className="lg:hidden">
            <Wordmark />
          </a>
          <nav className="flex items-center gap-5 text-[13px] text-muted-foreground">
            <a href={`${SITE}/docs`} className="transition-colors hover:text-foreground">
              Docs
            </a>
            <a href={`${SITE}/#pricing`} className="transition-colors hover:text-foreground">
              Pricing
            </a>
          </nav>
        </header>
        <main className="flex flex-1 items-center justify-center px-5 pt-6 pb-20">
          <div className="w-full max-w-[360px]">
            {top}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
