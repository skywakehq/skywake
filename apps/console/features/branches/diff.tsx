"use client";

import { diffLines } from "diff";
import { useMemo } from "react";
import { asText, useFetch } from "@/lib/fetch-text";
import { apiPath } from "@/lib/paths";
import { cx } from "@/components/kit";

const content = (ns: string, branch: string, path: string, at: string) =>
  apiPath(
    ns,
    `branches/${encodeURIComponent(branch)}/files/content?path=${encodeURIComponent(path)}&at=${at}`,
  );

/** What one commit did to one file, as a unified diff. */
export function FileDiff({
  ns,
  branch,
  path,
  at,
  parent,
  kind,
}: {
  ns: string;
  branch: string;
  path: string;
  at: string;
  parent?: string | null;
  kind: "added" | "removed" | "modified";
}) {
  const before = useFetch(
    kind !== "added" && parent ? content(ns, branch, path, parent) : null,
    asText,
  );
  const after = useFetch(kind !== "removed" ? content(ns, branch, path, at) : null, asText);
  const old = kind === "added" || !parent ? "" : before.state === "done" ? before.value : null;
  const now = kind === "removed" ? "" : after.state === "done" ? after.value : null;
  const failed = [before, after].find((loaded) => loaded.state === "failed");

  const lines = useMemo(() => {
    if (old === null || now === null) return null;
    if (old.includes("\0") || now.includes("\0")) return "binary";
    let a = 1;
    let b = 1;
    return diffLines(old, now).flatMap((part) =>
      part.value
        .replace(/\n$/, "")
        .split("\n")
        .map((text) => {
          const line = { text, sign: part.added ? "+" : part.removed ? "-" : " ", a: 0, b: 0 };
          if (!part.added) line.a = a++;
          if (!part.removed) line.b = b++;
          return line;
        }),
    );
  }, [old, now]);

  if (failed?.state === "failed") return <Note>{failed.error}</Note>;
  if (lines === null) return <Note>Loading…</Note>;
  if (lines === "binary") return <Note>A binary file.</Note>;
  return (
    <div className="overflow-x-auto font-mono text-xs leading-[19px]">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => (
            <tr
              key={i}
              className={cx(line.sign === "+" && "bg-green/10", line.sign === "-" && "bg-red/10")}
            >
              <td className="w-10 select-none pr-2 text-right text-faint">
                {line.sign !== "+" && line.a}
              </td>
              <td className="w-10 select-none pr-2 text-right text-faint">
                {line.sign !== "-" && line.b}
              </td>
              <td
                className={cx(
                  "w-4 select-none text-center",
                  line.sign === "+" && "text-green",
                  line.sign === "-" && "text-red",
                )}
              >
                {line.sign.trim()}
              </td>
              <td className="whitespace-pre pr-4">{line.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-4 text-sm text-muted-foreground">{children}</p>;
}
