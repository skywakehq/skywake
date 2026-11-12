"use client";

import { usePathname, useRouter } from "next/navigation";

import { localeNames, locales, stripLocale, type Locale } from "@/lib/i18n";

export function LocaleSwitcher({
  locale,
  label,
}: {
  locale: Locale;
  label: string;
}) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const bare = stripLocale(pathname);

  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        className="t-small h-9 cursor-pointer appearance-none rounded-md bg-transparent py-2 pr-7 pl-3 text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
        value={locale}
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value as Locale;
          const href = bare === "/" ? `/${next}` : `/${next}${bare}`;
          document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000`;
          router.push(href);
        }}
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {localeNames[code]}
          </option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-2 text-muted-foreground">
        ▾
      </span>
    </label>
  );
}
