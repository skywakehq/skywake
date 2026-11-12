"use client";

import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { DropdownSearch } from "@skywake/ui/components/dropdown";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/menu";

const CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(
    " ",
  );

function countries() {
  const names = new Intl.DisplayNames(undefined, { type: "region" });
  return CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/** Where the browser says the person is, as a country code, or US. */
export function guessCountry() {
  const region = new Intl.Locale(navigator.language).maximize().region;
  return region && CODES.includes(region) ? region : "US";
}

export function CountryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const all = useMemo(() => countries(), []);
  const [query, setQuery] = useState("");
  const shown = all.filter((country) =>
    country.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const current = all.find((country) => country.code === value);

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center justify-between border border-border px-3 text-left text-sm transition-colors hover:bg-foreground/[0.03]"
        >
          <span>{current?.name ?? value}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent
        align="start"
        className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        checkedIndex={shown.findIndex((country) => country.code === value)}
      >
        <DropdownSearch value={query} onValueChange={setQuery} placeholder="Search countries" />
        {shown.map((country, index) => (
          <MenuItem
            key={country.code}
            index={index}
            label={country.name}
            checked={country.code === value}
            onSelect={() => onChange(country.code)}
          />
        ))}
      </MenuContent>
    </Menu>
  );
}
