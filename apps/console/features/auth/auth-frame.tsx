import { Geist } from "next/font/google";
import type { ReactNode } from "react";
import { AuthPanel, Wordmark } from "./auth-panel";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

/** The sign-in pages and the first run: the grid on the left, one form on the right. */
export function AuthFrame({ top, children }: { top?: ReactNode; children: ReactNode }) {
  return (
    <div
      className={`${geist.variable} grid min-h-dvh bg-background font-[family-name:var(--font-geist)] antialiased lg:grid-cols-2`}
    >
      <AuthPanel />
      <div className="flex flex-col">
        <header className="flex h-14 items-center px-5 lg:hidden">
          <Wordmark />
        </header>
        <main className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-[380px]">
            {top}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
