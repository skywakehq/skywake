import type { Metadata, Viewport } from "next";
import { Geist, IBM_Plex_Mono } from "next/font/google";

import { pages } from "@/content/pages";
import { site } from "@/content/site";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { template: `%s · ${site.name}`, default: pages["/"].title },
  description: pages["/"].description,
  applicationName: site.name,
  keywords: [
    "S3 filesystem",
    "filesystem for AI agents",
    "agent sandbox storage",
    "copy-on-write filesystem",
    "object storage filesystem",
    "vector search on S3",
    "full-text search",
    "hybrid search",
    "MCP server",
  ],
  robots: { index: true, follow: true, googleBot: { "max-image-preview": "large" } },
  openGraph: { type: "website", siteName: site.name, locale: "en_US" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${mono.variable} antialiased`}
    >
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
