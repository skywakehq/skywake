"use client";

// The nav links on phones and tablets, in the design system's dropdown, like the language switcher.
import { Menu } from "lucide-react";
import { useRouter } from "next/navigation";

import { DropdownContent, DropdownMenu, DropdownTrigger } from "@skywake/ui/components/dropdown";
import { MenuItem } from "@skywake/ui/components/menu-item";
import { isSitePath, localizePath, type Locale } from "@/lib/i18n";
import { NAV_ICON } from "./nav-icon";

export function MobileMenu({
  links,
  locale,
  label,
}: {
  links: { href: string; label: string }[];
  locale: Locale;
  label: string;
}) {
  const router = useRouter();

  // Site paths stay in the app; docs and GitHub open as normal pages.
  function go(href: string) {
    if (isSitePath(href)) router.push(localizePath(locale, href));
    else window.location.assign(href);
  }

  return (
    <div className="lg:hidden">
      <DropdownMenu>
        <DropdownTrigger aria-label={label} className={NAV_ICON}>
          <Menu className="size-[18px]" />
        </DropdownTrigger>
        <DropdownContent align="end">
          {links.map((link, index) => (
            <MenuItem
              key={link.label}
              index={index}
              label={link.label}
              onSelect={() => go(link.href)}
            />
          ))}
        </DropdownContent>
      </DropdownMenu>
    </div>
  );
}
