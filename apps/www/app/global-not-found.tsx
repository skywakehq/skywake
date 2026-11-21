// The 404 for URLs outside any language, such as a mistyped file name. Pages
// under a language use app/[locale]/not-found.tsx instead.
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";

import { FolderIcon } from "@/components/ui/folder-icon";

import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = { title: "Not found · Skywake" };

export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${geist.variable} dark antialiased`}>
      <body className="grid min-h-dvh place-items-center bg-background text-center text-foreground">
        <div className="flex flex-col items-center">
          <FolderIcon className="mb-10 w-32 -rotate-6" />
          <p className="text-sm font-medium text-muted-foreground">404</p>
          <h1 className="t-h2 mt-4">This page doesn’t exist.</h1>
          <Link href="/" className="btn btn-primary mt-8">
            Back to the home page
          </Link>
        </div>
      </body>
    </html>
  );
}
