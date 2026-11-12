import { Geist } from "next/font/google";
import { connection } from "next/server";
import { AuthOptionsProvider } from "@/features/auth/options";
import { AuthPanel, Wordmark } from "@/features/auth/auth-panel";
import { authOptions } from "@/server/hosted";

// The landing page's typeface, so these pages read as part of the site.
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  // What these pages offer depends on settings read when the server runs.
  await connection();
  return (
    <div
      className={`${geist.variable} grid min-h-dvh bg-background font-[family-name:var(--font-geist)] antialiased lg:grid-cols-2`}
    >
      <AuthPanel />
      <div className="flex flex-col">
        <header className="flex h-14 items-center border-b border-border px-5 lg:hidden">
          <Wordmark />
        </header>
        <main className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-[340px]">
            <AuthOptionsProvider value={authOptions()}>{children}</AuthOptionsProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
