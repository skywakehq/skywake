import {
  BookOpen,
  Building2,
  ChartNoAxesColumn,
  CreditCard,
  FileText,
  HardDrive,
  Heart,
  Layers,
  Search,
  Shield,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { site } from "./site";

export type NavLink = { href: string; label: string };

export const navLinks: NavLink[] = [
  { href: "/filesystem", label: "Filesystem" },
  { href: "/search", label: "Search" },
  { href: "/#benchmarks", label: "Benchmarks" },
  { href: "/pricing", label: "Pricing" },
  { href: site.docsUrl, label: "Docs" },
];

export type FooterColumn = { title: string; links: (NavLink & { icon: LucideIcon })[] };

export const footerColumns: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { href: "/filesystem", label: "Filesystem", icon: HardDrive },
      { href: "/search", label: "Search", icon: Search },
      { href: "/agents", label: "Agents", icon: Sparkles },
      { href: "/use-cases", label: "Use cases", icon: Layers },
      { href: "/pricing", label: "Pricing", icon: CreditCard },
      { href: "/enterprise", label: "Enterprise", icon: Building2 },
    ],
  },
  {
    title: "Project",
    links: [
      { href: site.docsUrl, label: "Docs", icon: BookOpen },
      { href: "/#benchmarks", label: "Benchmarks", icon: ChartNoAxesColumn },
      { href: "/#open-source", label: "Open source", icon: Heart },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy", icon: Shield },
      { href: "/terms", label: "Terms", icon: FileText },
    ],
  },
];
