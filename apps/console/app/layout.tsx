import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@skywake/ui/components/sonner";
import { TooltipProvider } from "@skywake/ui/components/tooltip";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], axes: ["opsz"] });
const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  // Where people reach the console; the base path is added to every link.
  metadataBase: new URL(process.env.BETTER_AUTH_URL ?? "https://skywake.dev"),
  title: { template: "%s · Skywake", default: "Skywake console" },
  description: "The Skywake console: disks, branches and search indexes for your AI agents.",
  applicationName: "Skywake",
  // The console is private; only sign-in and sign-up ask to be indexed.
  robots: { index: false, follow: false },
  openGraph: { type: "website", siteName: "Skywake" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          {/* Bottom right holds the upload tray. */}
          <Toaster position="bottom-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
