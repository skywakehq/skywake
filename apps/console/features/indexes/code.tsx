"use client";

import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Choice, cx } from "@/components/kit";
import type { Lang } from "./snippets";

export const LANGS: { value: Lang; label: string }[] = [
  { value: "ts", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "curl", label: "curl" },
];

export function LangChoice({ value, onChange }: { value: Lang; onChange: (lang: Lang) => void }) {
  return <Choice value={value} onChange={onChange} options={LANGS} />;
}

const TOKEN =
  /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(import|from|const|await|new|curl|True|False|None|true|false|null)\b|(-?\b\d+(?:\.\d+)?\b)|([{}[\](),:;=.!])/g;

const TONES = ["text-foreground", "text-muted-foreground", "text-foreground/90", "text-faint"];

export function Highlighted({ code }: { code: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of code.matchAll(TOKEN)) {
    if (match.index > at) parts.push(code.slice(at, match.index));
    const tone = match.slice(1).findIndex((group) => group !== undefined);
    parts.push(
      <span key={match.index} className={TONES[tone]}>
        {match[0]}
      </span>,
    );
    at = match.index + match[0].length;
  }
  parts.push(code.slice(at));
  return <code className="text-muted-foreground/90">{parts}</code>;
}

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cx("relative", className)}>
      <pre className="rounded-lg overflow-x-auto bg-muted/50 p-4 font-mono text-xs leading-5">
        <Highlighted code={code} />
      </pre>
      <CopyIcon text={code} className="absolute top-2 right-2" />
    </div>
  );
}

export function CodePane({
  code,
  lang,
  onLang,
  className,
}: {
  code: string;
  lang: Lang;
  onLang: (lang: Lang) => void;
  className?: string;
}) {
  return (
    <div className={cx("flex min-w-0 flex-col", className)}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <LangChoice value={lang} onChange={onLang} />
        <CopyIcon text={code} className="ml-auto" />
      </div>
      <pre className="flex-1 overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-[22px]">
        <Highlighted code={code} />
      </pre>
    </div>
  );
}

export function CopyIcon({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy"}
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className={cx(
        "rounded-md grid size-7 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}
