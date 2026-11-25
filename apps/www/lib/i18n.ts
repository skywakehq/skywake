export const locales = ["de", "en", "es", "fr", "it"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
  es: "Español",
  fr: "Français",
  it: "Italiano",
};

export const localeFlags: Record<Locale, string> = {
  de: "🇩🇪",
  en: "🇺🇸",
  es: "🇪🇸",
  fr: "🇫🇷",
  it: "🇮🇹",
};

export const localeOg: Record<Locale, string> = {
  de: "de_DE",
  en: "en_US",
  es: "es_ES",
  fr: "fr_FR",
  it: "it_IT",
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

const ZONES = ["/docs", "/dashboard"];

export function isZonePath(path: string) {
  return ZONES.some((zone) => path === zone || path.startsWith(`${zone}/`));
}

export function isSitePath(href: string) {
  return href.startsWith("/") && !isZonePath(href);
}

// English lives at the root ("/pricing"); other languages have a prefix ("/fr/pricing").
export function localizePath(locale: Locale, path = "/") {
  const prefix = locale === defaultLocale ? "" : `/${locale}`;
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const bare = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const normalized = bare.startsWith("/") ? bare : `/${bare}`;
  if (normalized === "/") return `${prefix || "/"}${hash}`;
  return `${prefix}${normalized}${hash}`;
}

export function stripLocale(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] && isLocale(parts[0])) {
    const rest = parts.slice(1).join("/");
    return rest ? `/${rest}` : "/";
  }
  return pathname || "/";
}
