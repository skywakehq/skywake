"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
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

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cx("relative", className)}>
      <pre className="rounded-lg overflow-x-auto bg-muted/50 p-4 font-mono text-xs leading-5">
        {code}
      </pre>
      <CopyIcon text={code} className="absolute top-2 right-2" />
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
