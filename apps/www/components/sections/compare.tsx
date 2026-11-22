import { Logo } from "@skywake/ui/components/logo";
import { Check, X } from "lucide-react";
import { siDropbox, siGoogledrive, type SimpleIcon } from "simple-icons";

import { BrandIcon } from "@/components/ui/brand-icon";
import { CtaRow } from "@/components/ui/cta-row";
import { Band } from "@/components/ui/frame";
import { Head } from "@/components/ui/statement";
import { compareRows } from "@/content/compare";
import type { HomeMessages } from "@/content/messages";
import { cn } from "@/lib/utils";

const RIVALS: { name: string; icon: SimpleIcon }[] = [
  { name: "Google Drive", icon: siGoogledrive },
  { name: "Dropbox", icon: siDropbox },
];

function Mark({ on, lit, t }: { on: boolean; lit?: boolean; t: HomeMessages["compare"] }) {
  return on ? (
    <span
      className={cn(
        "grid size-6 place-items-center rounded-full",
        lit ? "bg-signal text-background" : "bg-foreground/[0.07] text-foreground",
      )}
    >
      <Check className="size-3.5" strokeWidth={3} aria-label={t.yes} />
    </span>
  ) : (
    <span className="grid size-6 place-items-center rounded-full bg-[#e5484d]/12 text-[#e5484d]">
      <X className="size-3.5" strokeWidth={3} aria-label={t.no} />
    </span>
  );
}

/** Skywake next to Google Drive and Dropbox: the same folder idea, built for agents. */
export function Compare({ t }: { t: HomeMessages }) {
  const c = t.compare;
  const scores = [0, 1, 2].map((j) => compareRows.filter((row) => row[j]).length);
  return (
    <>
      <Head id="compare" title={c.title} line={c.line} />
      <Band>
        <div className="panel reveal p-1.5 sm:p-3">
          <table className="w-full table-fixed border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th scope="col" className="w-[52%] sm:w-[46%]" />
                {RIVALS.map((rival) => (
                  <th
                    key={rival.name}
                    scope="col"
                    className="px-1 py-4 text-center font-normal sm:px-3 sm:py-5"
                  >
                    <span className="inline-flex flex-col items-center gap-2 text-sm text-muted-foreground">
                      <BrandIcon icon={rival.icon} className="size-5" />
                      <span className="max-sm:sr-only">{rival.name}</span>
                    </span>
                  </th>
                ))}
                <th
                  scope="col"
                  className="rounded-t-[1rem] bg-background px-1 py-4 text-center font-medium sm:px-3 sm:py-5"
                >
                  <span className="inline-flex flex-col items-center gap-2 text-sm text-foreground">
                    <Logo className="size-5" />
                    <span className="max-sm:sr-only">Skywake</span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map((row, i) => {
                return (
                  <tr key={c.rows[i]}>
                    <th
                      scope="row"
                      className="border-t border-(--hairline) px-3 py-3.5 text-sm font-normal text-foreground sm:px-5 sm:py-4 sm:text-[15px]"
                    >
                      {c.rows[i]}
                    </th>
                    {row.map((on, j) => (
                      <td
                        key={j}
                        className={cn(
                          "border-t border-(--hairline) px-1 py-3.5 sm:px-3 sm:py-4",
                          j === 2 && "bg-background",
                        )}
                      >
                        <span className="flex justify-center">
                          <Mark on={on} lit={j === 2} t={c} />
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr>
                <th
                  scope="row"
                  className="border-t border-(--hairline) px-3 py-4 text-sm font-medium text-foreground sm:px-5 sm:py-5 sm:text-[15px]"
                >
                  {c.score}
                </th>
                {scores.map((score, j) => (
                  <td
                    key={j}
                    className={cn(
                      "border-t border-(--hairline) px-1 py-4 text-center font-mono text-sm tabular-nums sm:px-3 sm:py-5 sm:text-base",
                      j === 2
                        ? "rounded-b-[1rem] bg-background font-semibold text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {score}/{compareRows.length}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <CtaRow t={t} label={c.cta} docs={false} className="mt-8" />
      </Band>
    </>
  );
}
