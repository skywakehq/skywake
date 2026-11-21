// The pieces a use case guide is written with. Each guide reads like a blog
// post, with its own story and steps; these only keep the look the same.
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Callout } from "fumadocs-ui/components/callout";
import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";
import { InlineTOC } from "fumadocs-ui/components/inline-toc";
import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { getMessages } from "@/content/messages";
import { localizePath, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Band } from "@/components/ui/frame";
import { GuideToc } from "@/components/guides/guide-toc";

const PAD = "px-6 sm:px-10 lg:px-12";

/** The top of a guide, centred like every other page's hero: where it sits, the title, one line on what you'll learn, the facts, and a cover. */
export function ArticleHero({
  locale,
  name,
  title,
  dek,
  meta,
  cover,
}: {
  locale: Locale;
  name: string;
  title: ReactNode;
  dek: ReactNode;
  meta: string[];
  /** A small window from the product, shown on a band of tiles like a blog post's cover. */
  cover: ReactNode;
}) {
  return (
    <>
      <section
        className={cn(PAD, "flex flex-col items-center pt-24 pb-20 text-center lg:pt-32 lg:pb-28")}
      >
        <p className="text-sm font-medium text-muted-foreground">
          <Link
            href={localizePath(locale, "/use-cases")}
            className="text-signal transition-colors hover:text-foreground"
          >
            {getMessages(locale).guides.eyebrow}
          </Link>
          <span className="mx-2.5 text-muted-foreground/40">/</span>
          {name}
        </p>
        <h1 className="t-display mt-6 max-w-[20ch] text-balance text-foreground">{title}</h1>
        <p className="t-lead mt-8 max-w-[52ch] text-muted-foreground">{dek}</p>
        <ul className="mt-8 flex flex-wrap justify-center gap-2">
          {meta.map((item) => (
            <li
              key={item}
              className="t-small rounded-full bg-(--soft) px-3 py-1 text-muted-foreground"
            >
              {item}
            </li>
          ))}
        </ul>
      </section>
      <Band className="panel panel-sun grid h-[22rem] place-items-center px-6 sm:h-[26rem]">
        <div className="tile w-full max-w-[32rem] -rotate-1 overflow-hidden">
          <div className="flex h-9 items-center gap-1.5 px-4">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-2.5 rounded-full bg-foreground/12" />
            ))}
          </div>
          <div className="px-5 pb-5 text-[13px] text-foreground">{cover}</div>
        </div>
      </Band>
    </>
  );
}

/**
 * The guide itself, read like a blog post: one column of text, with the
 * contents in view on the left. Write Chapter, h3, p, ul and figures inside.
 */
export function Article({
  locale,
  toc,
  children,
}: {
  locale: Locale;
  toc: [id: string, label: string][];
  children: ReactNode;
}) {
  const label = getMessages(locale).guides.onThisPage;
  // One column on phones, held to the screen's width so wide code can't stretch it.
  return (
    <Band className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label={label} className="hidden lg:block">
        <div className="sticky top-24 px-8 py-16">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <GuideToc items={toc} />
        </div>
      </nav>
      <article
        className={cn(
          PAD,
          "max-w-[48rem] py-14 text-[1.0625rem] leading-[1.75] text-pretty lg:py-20",
          "text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]",
          "[&_b]:font-normal [&_b]:text-foreground",
          "[&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-foreground/[0.06] [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.8125em] [&_:not(pre)>code]:text-foreground",
          "[&>h3]:mt-10 [&>h3]:mb-3 [&>h3]:font-medium [&>h3]:text-foreground",
          "[&>p]:mb-5",
          "[&>ul]:mb-6 [&>ul]:grid [&>ul]:gap-2.5 [&>ul>li]:relative [&>ul>li]:pl-6",
          "[&>ul>li]:before:absolute [&>ul>li]:before:top-[0.7em] [&>ul>li]:before:left-1 [&>ul>li]:before:size-1.5 [&>ul>li]:before:rotate-45 [&>ul>li]:before:rounded-[1px] [&>ul>li]:before:bg-signal [&>ul>li]:before:content-['']",
          "[&>figure]:my-8 [&>aside]:my-8",
        )}
      >
        <InlineTOC
          items={toc.map(([id, label]) => ({ title: label, url: `#${id}`, depth: 2 }))}
          className="mb-10 lg:hidden"
        >
          {label}
        </InlineTOC>
        {children}
      </article>
    </Band>
  );
}

/**
 * A part of the guide. A step gets its number and a hairline above it, so
 * the steps read as the spine of the article.
 */
export function Chapter({ id, step, title }: { id: string; step?: number; title: string }) {
  return (
    <header id={id} className={cn("mb-6 scroll-mt-28 first-of-type:mt-0", "mt-16")}>
      {step && <Eyebrow>Step {step}</Eyebrow>}
      <h2
        className={cn(
          "text-[1.625rem] leading-[1.25] font-medium tracking-[-0.02em] text-foreground",
          step && "mt-4",
        )}
      >
        {title}
      </h2>
    </header>
  );
}

/** Body text outside an Article. Bold words read as plain text in the foreground colour. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid gap-3 [&_b]:font-normal [&_b]:text-foreground [&_code]:font-mono [&_code]:text-[0.875em] [&_code]:text-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

// The language to highlight, from the file's extension.
const LANGS: Record<string, string> = { ts: "ts", tsx: "tsx", js: "js", py: "python", sh: "bash" };

/** A file of code, with its name on a tab. Fumadocs' code block: highlighted, scrolls on its own, with a copy button. */
export async function Code({ file, code }: { file: string; code: string }) {
  // Cached so the highlighting happens once, at build time. Without it the
  // highlighter reads the clock and the page can't be prerendered.
  "use cache";
  return (
    <ServerCodeBlock
      code={code.trim()}
      lang={LANGS[file.split(".").pop() ?? ""] ?? "text"}
      codeblock={{ title: file }}
    />
  );
}

/** A folder as a list of paths, each with an optional note. */
export function Tree({ root, items }: { root: string; items: [path: string, note?: string][] }) {
  return (
    <figure className="rounded-2xl bg-(--panel) p-5 font-mono text-[13px] leading-7">
      <p className="text-foreground">{root}/</p>
      <ul>
        {items.map(([path, note], i) => (
          <li key={path} className="flex gap-3">
            <span aria-hidden className="text-muted-foreground/50">
              {i === items.length - 1 ? "└─" : "├─"}
            </span>
            <span className="text-foreground">{path}</span>
            {note && <span className="text-muted-foreground"># {note}</span>}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** What the reader will have at the end, ticked off. */
export function Checklist({ items }: { items: ReactNode[] }) {
  return (
    <ul className="my-8 grid gap-1 overflow-hidden rounded-2xl bg-(--panel) p-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3 rounded-xl bg-background px-5 py-4">
          <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-signal/12 text-signal">
            <Check className="size-3" strokeWidth={2.5} />
          </span>
          <span className="text-foreground">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A short note in the text: something worth knowing, not a step. */
export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Callout type="idea" title={title}>
      <Prose>{children}</Prose>
    </Callout>
  );
}

/** Questions and answers, each one opened on a tap. */
export function Questions({ items }: { items: [question: string, answer: ReactNode][] }) {
  return (
    <Accordions type="multiple">
      {items.map(([question, answer]) => (
        <Accordion key={question} title={question}>
          <Prose>{answer}</Prose>
        </Accordion>
      ))}
    </Accordions>
  );
}
