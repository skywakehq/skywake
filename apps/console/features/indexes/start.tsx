"use client";

import { ArrowRight, ArrowUpRight, Check, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button, cx } from "@/components/kit";
import { useUrls } from "@/components/shell/console";
import { Link, navigate } from "@/components/shell/router";
import { nameInEnv } from "@/lib/names";
import { indexPath } from "@/lib/paths";
import { type AttributeColumn, type IndexInfo, type Schema, branchUrl, call } from "./api";
import { CodeBlock, LangChoice } from "./code";
import { type Lang, type Request, snippet, writeSnippet } from "./snippets";

const SAMPLES: [string, string][] = [
  ["refunds", "Customers can return a purchase within 30 days for a full refund to their card."],
  ["shipping", "Orders leave the warehouse in two business days and arrive within a week."],
  ["password", "Forgot your password? The sign-in page emails you a link to reset it."],
  ["pets", "Dogs and cats are welcome in the office on Fridays, on a leash."],
  ["outage", "When the service is down, the status page posts an update every half hour."],
  ["remote", "Everyone may work from home three days a week; we pay for the desk and chair."],
];

const QUESTION = "can I bring my puppy to work";
const PLACEHOLDER_VECTOR = [0.12, -0.03, 0.88];

const EXAMPLE_VALUE: Record<AttributeColumn["type"], unknown> = {
  string: "guides",
  number: 42,
  bool: true,
  strings: ["new", "popular"],
  text: SAMPLES[0]![1],
};

const embedsAll = (schema: Schema) => schema.vectors.every((v) => v.embed);

const sources = (schema: Schema) =>
  new Set(schema.vectors.flatMap((v) => (v.embed?.from ? [v.embed.from] : [])));

function document(schema: Schema, id: string, text: string, every: boolean) {
  const from = sources(schema);
  const vectors = Object.fromEntries(
    schema.vectors
      .filter((v) => !v.embed?.from)
      .map((v) => [v.name, v.embed ? text : PLACEHOLDER_VECTOR]),
  );
  const attributes = Object.fromEntries(
    schema.attributes
      .filter((a) => every || a.type === "text" || from.has(a.name))
      .map((a) => [a.name, a.type === "text" || from.has(a.name) ? text : EXAMPLE_VALUE[a.type]]),
  );
  return {
    id,
    ...(Object.keys(vectors).length ? { vectors } : {}),
    ...(Object.keys(attributes).length ? { attributes } : {}),
  };
}

const samples = (schema: Schema) =>
  embedsAll(schema) ? SAMPLES.map(([id, text]) => document(schema, id, text, false)) : null;

function question(schema: Schema): Request {
  const column = schema.vectors[0];
  if (!column) {
    return { route: "search", body: { query: "reset password", topK: 5 } };
  }
  return {
    route: "query",
    body: {
      vector: { column: column.name, value: column.embed ? QUESTION : PLACEHOLDER_VECTOR },
      topK: 5,
    },
  };
}

const code = (name: string) => (
  <code className="font-mono text-[12.5px] text-foreground">{name}</code>
);

function describe(schema: Schema): ReactNode[] {
  const lines: ReactNode[] = schema.vectors.map((v) =>
    v.embed?.from ? (
      <>
        {code(v.embed.from)} is turned into a vector by {v.embed.model}, so you can search by
        meaning.
      </>
    ) : v.embed ? (
      <>
        Send text for {code(v.name)} and {v.embed.model} turns it into a vector.
      </>
    ) : (
      <>
        Each document brings {v.dims} numbers for {code(v.name)} from your embedding model.
      </>
    ),
  );
  for (const a of schema.attributes.filter((a) => a.type === "text")) {
    lines.push(<>{code(a.name)} is searched by keyword too.</>);
  }
  return lines;
}

export function Start({
  index,
  branch,
  written,
  queried,
  onWritten,
}: {
  index: IndexInfo;
  branch: string;
  written: boolean;
  queried: boolean;
  onWritten: () => void;
}) {
  const api = useUrls().api;
  const [lang, setLang] = useState<Lang>("ts");
  const [busy, setBusy] = useState(false);
  const { schema } = index;
  const ready = samples(schema);
  const example = [document(schema, "doc-1", SAMPLES[0]![1], true)];
  const needsVectors = schema.vectors.some((v) => !v.embed);

  async function addSamples() {
    if (!ready) return;
    setBusy(true);
    try {
      const { count } = await call<{ count: number }>(
        "POST",
        branchUrl(index.name, branch, "documents"),
        { documents: ready },
      );
      toast.success(`Added ${count} sample documents`);
      onWritten();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    }
    setBusy(false);
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-xl overflow-hidden border bg-card"
    >
      <header className="border-b px-6 py-6 max-sm:px-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-micro font-medium tracking-wide text-faint uppercase">Get started</p>
            <h2 className="mt-1.5 text-lg leading-6 font-semibold tracking-[-0.015em]">
              {written
                ? `Search ${nameInEnv(index.name)}`
                : `Put your first documents in ${nameInEnv(index.name)}`}
            </h2>
            <div className="mt-1.5 grid max-w-xl gap-0.5 text-sm text-muted-foreground">
              {describe(schema).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
          <Progress done={Number(written) + Number(queried)} of={2} />
        </div>
      </header>

      <ol className="grid px-6 py-2 max-sm:px-4">
        <Step
          number={1}
          done={written}
          active={!written}
          last={false}
          title="Write documents"
          body={
            needsVectors
              ? "Send each document with its vector. Writing the same id again replaces it."
              : "Send each document's text; the server embeds it as it writes."
          }
          actions={
            <>
              {ready && !written && (
                <Button
                  variant="primary"
                  size="default"
                  leadingIcon={Sparkles}
                  disabled={busy}
                  onClick={addSamples}
                >
                  {busy ? "Adding…" : "Add sample documents"}
                </Button>
              )}
              <Button
                size="default"
                trailingIcon={ArrowRight}
                onClick={() => navigate(indexPath(index.name, "documents"))}
              >
                Paste JSON
              </Button>
              <KeyLink />
            </>
          }
          code={writeSnippet(lang, index.name, branch, example, api)}
          lang={lang}
          onLang={setLang}
        />
        <Step
          number={2}
          done={queried}
          active={written && !queried}
          last
          title={schema.vectors.some((v) => v.embed) ? "Search by meaning" : "Query it"}
          body={
            schema.vectors[0]?.embed
              ? `Ask in plain words. "${QUESTION}" finds the pets policy, though no word matches.`
              : schema.vectors.length
                ? "Give a vector from the same model, and get the nearest documents back."
                : "Type words, and get the documents that use them most, best first."
          }
          actions={
            <Button
              variant={written && !queried ? "primary" : "ghost"}
              size="default"
              trailingIcon={ArrowRight}
              onClick={() => navigate(indexPath(index.name, "query"))}
            >
              Open the playground
            </Button>
          }
          code={snippet(lang, index.name, branch, question(schema), api)}
          lang={lang}
          onLang={setLang}
        />
      </ol>
    </motion.section>
  );
}

function Progress({ done, of }: { done: number; of: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <div className="flex gap-1">
        {Array.from({ length: of }, (_, i) => (
          <span
            key={i}
            className={cx(
              "h-1 w-5 rounded-full transition-colors",
              i < done ? "bg-foreground" : "bg-foreground/15",
            )}
          />
        ))}
      </div>
      {done} of {of}
    </div>
  );
}

function Step({
  number,
  done,
  active,
  last,
  title,
  body,
  actions,
  code,
  lang,
  onLang,
}: {
  number: number;
  done: boolean;
  active: boolean;
  last: boolean;
  title: string;
  body: string;
  actions: ReactNode;
  code: string;
  lang: Lang;
  onLang: (lang: Lang) => void;
}) {
  return (
    <li className="relative grid grid-cols-[1.5rem_1fr] gap-x-4 py-5">
      {!last && (
        <span
          aria-hidden
          className="absolute top-12 bottom-0 left-3 w-px -translate-x-1/2 bg-border"
        />
      )}
      <span
        className={cx(
          "relative z-10 grid size-6 place-items-center rounded-full text-xs font-medium tabular-nums transition-colors",
          done ? "bg-foreground text-background" : "border bg-background text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3.5" strokeWidth={2.5} /> : number}
      </span>
      <div className="grid min-w-0 gap-3">
        <div className="grid gap-1">
          <h3 className={cx("text-sm font-medium leading-6", !active && "text-muted-foreground")}>
            {title}
            {done && <span className="ml-2 text-xs font-normal text-faint">Done</span>}
          </h3>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
        {active && (
          <>
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
            <div className="grid gap-2">
              <LangChoice value={lang} onChange={onLang} />
              <CodeBlock code={code} />
            </div>
          </>
        )}
      </div>
    </li>
  );
}

function KeyLink() {
  return (
    <Link
      href="/settings#keys"
      className="ml-1 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      Get an API key
      <ArrowUpRight className="size-3.5" />
    </Link>
  );
}
