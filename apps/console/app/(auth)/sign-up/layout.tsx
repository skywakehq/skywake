import type { Metadata } from "next";
import { withBase } from "@/lib/zone";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Create a Skywake account: a shared filesystem with branches, and search, for your AI agents.",
  // Metadata links don't get the base path on their own.
  alternates: { canonical: withBase("/sign-up") },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Create your account · Skywake",
    description:
      "Create a Skywake account: a shared filesystem with branches, and search, for your AI agents.",
  },
  twitter: {
    title: "Create your account · Skywake",
    description:
      "Create a Skywake account: a shared filesystem with branches, and search, for your AI agents.",
  },
};

export default function Layout({ children }: LayoutProps<"/sign-up">) {
  return children;
}
