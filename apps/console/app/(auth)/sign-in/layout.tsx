import type { Metadata } from "next";
import { withBase } from "@/lib/zone";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Skywake, the shared filesystem and search for your AI agents.",
  // Metadata links don't get the base path on their own.
  alternates: { canonical: withBase("/sign-in") },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Sign in · Skywake",
    description: "Sign in to Skywake, the shared filesystem and search for your AI agents.",
  },
  twitter: {
    title: "Sign in · Skywake",
    description: "Sign in to Skywake, the shared filesystem and search for your AI agents.",
  },
};

export default function Layout({ children }: LayoutProps<"/sign-in">) {
  return children;
}
