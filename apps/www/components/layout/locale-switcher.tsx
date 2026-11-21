"use client";

import { usePathname, useRouter } from "next/navigation";

import { DropdownContent, DropdownMenu, DropdownTrigger } from "@skywake/ui/components/dropdown";
import { MenuItem } from "@skywake/ui/components/menu-item";
import { localeFlags, localeNames, locales, stripLocale, type Locale } from "@/lib/i18n";
import { NAV_ICON } from "./nav-icon";

// The middleware reads this cookie to send later visits to the same language.
function remember(locale: Locale) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000`;
}

export function LocaleSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const bare = stripLocale(pathname);

  function choose(next: Locale) {
    remember(next);
    router.push(bare === "/" ? `/${next}` : `/${next}${bare}`);
  }

  return (
    <DropdownMenu>
      <DropdownTrigger aria-label={label} className={NAV_ICON}>
        <span aria-hidden className="text-lg leading-none">
          {localeFlags[locale]}
        </span>
      </DropdownTrigger>
      <DropdownContent align="end" checkedIndex={locales.indexOf(locale)}>
        {locales.map((code, index) => (
          <MenuItem
            key={code}
            index={index}
            checked={code === locale}
            label={`${localeFlags[code]}  ${localeNames[code]}`}
            onSelect={() => choose(code)}
          />
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}
