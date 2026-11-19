import type { Metadata, Viewport } from "next";
import { Geist, IBM_Plex_Mono } from "next/font/google";
import { notFound } from "next/navigation";

import { Providers } from "@/components/layout/providers";
import { getMessages } from "@/content/messages";
import { site } from "@/content/site";
import { isLocale, locales } from "@/lib/i18n";
import "../globals.css";

// The root layout sits under the language, so <html lang> is right in the first byte.
export const instant = false;

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const home = getMessages(isLocale(locale) ? locale : "en").pages["/"];
  return {
    metadataBase: new URL(site.url),
    title: { template: `%s · ${site.name}`, default: home.title },
    description: home.description,
    applicationName: site.name,
    keywords: [
      "search on object storage",
      "vector search on S3",
      "full-text search",
      "hybrid search",
      "BM25",
      "open-source vector database",
      "turbopuffer alternative",
      "self-hosted search",
    ],
    robots: { index: true, follow: true, googleBot: { "max-image-preview": "large" } },
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#08090a" },
  ],
};

export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geist.variable} ${mono.variable} antialiased`}
    >
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
