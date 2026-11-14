"use client";

import { ChevronDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { DropdownContent, DropdownMenu, DropdownTrigger } from "@skywake/ui/components/dropdown";
import { MenuItem } from "@skywake/ui/components/menu-item";
import { localeFlags, localeNames, locales, stripLocale, type Locale } from "@/lib/i18n";

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
      <DropdownTrigger
        aria-label={label}
        className="t-small inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.05] hover:text-foreground data-[state=open]:bg-foreground/[0.05] data-[state=open]:text-foreground"
      >
        <span aria-hidden className="text-base leading-none">
          {localeFlags[locale]}
        </span>
        <span className="hidden sm:inline">{localeNames[locale]}</span>
        <ChevronDown className="size-3.5" />
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
