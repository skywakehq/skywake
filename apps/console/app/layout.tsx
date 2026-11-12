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

export const metadata: Metadata = { title: "Skywake" };

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
