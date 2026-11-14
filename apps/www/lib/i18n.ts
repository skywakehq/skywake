export const locales = ["en", "it", "fr", "es", "de"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  en: "English",
  it: "Italiano",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
};

export const localeFlags: Record<Locale, string> = {
  en: "🇺🇸",
  it: "🇮🇹",
  fr: "🇫🇷",
  es: "🇪🇸",
  de: "🇩🇪",
};

export const localeOg: Record<Locale, string> = {
  en: "en_US",
  it: "it_IT",
  fr: "fr_FR",
  es: "es_ES",
  de: "de_DE",
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function localizePath(locale: Locale, path = "/") {
  if (path.startsWith("/#")) return `/${locale}${path.slice(1)}`;
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const bare = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const normalized = bare.startsWith("/") ? bare : `/${bare}`;
  if (normalized === "/") return `/${locale}${hash}`;
  return `/${locale}${normalized}${hash}`;
}

export function stripLocale(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] && isLocale(parts[0])) {
    const rest = parts.slice(1).join("/");
    return rest ? `/${rest}` : "/";
  }
  return pathname || "/";
}
