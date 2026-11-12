import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { absoluteUrl, basePath } from "@/lib/zone";
import "./global.css";

// The site's type: Inter with its optical-size axis, Plex Mono for code.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], axes: ["opsz"] });
const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(absoluteUrl("/")),
  title: { template: "%s · Skywake docs", default: "Skywake docs" },
  description:
    "Guides and reference for Skywake: a filesystem with branches, and vector and full-text search, on your own object storage.",
  applicationName: "Skywake",
  openGraph: { type: "website", siteName: "Skywake docs", locale: "en_US" },
  twitter: { card: "summary_large_image" },
  alternates: { types: { "text/plain": absoluteUrl("/llms.txt") } },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${mono.variable} antialiased`}
    >
      <body className="flex min-h-dvh flex-col">
        {/* The search client fetches with no basePath of its own. */}
        <RootProvider search={{ options: { api: `${basePath}/api/search` } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
