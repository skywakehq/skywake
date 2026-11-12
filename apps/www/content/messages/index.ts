import type { Locale } from "@/lib/i18n";
import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { it } from "./it";
import type { HomeMessages } from "./types";

const catalogs: Record<Locale, HomeMessages> = { en, it, fr, es, de };

export function getMessages(locale: Locale): HomeMessages {
  return catalogs[locale] ?? en;
}

export type { HomeMessages };
