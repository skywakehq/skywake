"use client";

import { useLenis } from "lenis/react";
import { ArrowRight } from "lucide-react";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  type MotionValue,
  useScroll,
  useTransform,
} from "motion/react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { FolderIcon } from "@/components/ui/folder-icon";
import { cn } from "@/lib/utils";

function Step({
  progress,
  index,
  count,
  onClick,
}: {
  progress: MotionValue<number>;
  index: number;
  count: number;
  onClick: () => void;
}) {
  const fill = useTransform(progress, (p) => Math.min(1, Math.max(0, p * count - index)));
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={onClick}
      className="h-1 w-6 overflow-hidden rounded-full bg-foreground/15"
    >
      <motion.span
        style={{ scaleX: fill }}
        className="block size-full origin-left rounded-full bg-foreground"
      />
    </button>
  );
}

export type UseCaseItem = {
  key: string;
  name: string;
  title: string;
  href: string;
  picture: ReactNode;
};

/** Use cases that change as the page scrolls past, with a list on the left to jump to any of them. */
export function UseCaseScroller({
  head,
  more,
  items,
  cta,
}: {
  head: ReactNode;
  more: ReactNode;
  items: UseCaseItem[];
  cta: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLUListElement>(null);
  const still = useReducedMotion() ?? false;
  const lenis = useLenis();
  const [open, setOpen] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });

  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    setOpen(Math.min(items.length - 1, Math.max(0, Math.floor(progress * items.length))));
  });

  // On phones the tabs scroll sideways: keep the open one in view.
  useEffect(() => {
    const list = tabs.current;
    const tab = list?.children[open] as HTMLElement | undefined;
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: tab.offsetLeft - 16, behavior: still ? "auto" : "smooth" });
  }, [open, still]);

  const jump = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const span = el.offsetHeight - window.innerHeight;
    const target = top + (span * (i + 0.5)) / items.length;
    if (lenis) lenis.scrollTo(target);
    else window.scrollTo({ top: target, behavior: still ? "auto" : "smooth" });
  };

  const item = items[open]!;
  return (
    <div
      ref={ref}
      style={{ height: `calc(${items.length} * var(--per-item) + 100vh)` }}
      className="relative [--per-item:22vh] lg:[--per-item:40vh]"
    >
      <div className="sticky top-24 flex h-[calc(100svh-7rem)] min-h-[40rem] flex-col pb-6">
        {head}
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:grid-rows-1">
          <div className="flex min-w-0 flex-col gap-4">
            <ul
              ref={tabs}
              role="tablist"
              className="flex gap-1 overflow-x-auto [scrollbar-width:none] max-lg:[mask-image:linear-gradient(to_right,black_85%,transparent)] lg:flex-col"
            >
              {items.map((entry, i) => (
                <li key={entry.key} className="shrink-0">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={i === open}
                    onClick={() => jump(i)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors outline-none focus-visible:bg-(--soft)",
                      i === open
                        ? "bg-(--panel) text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <motion.span
                      animate={i === open ? { rotate: -8, scale: 1.15 } : { rotate: 0, scale: 1 }}
                      transition={{ type: "spring", stiffness: 380, damping: 18 }}
                    >
                      <FolderIcon className={cn("w-8", i !== open && "brightness-90")} />
                    </motion.span>
                    <span className="text-base font-medium whitespace-nowrap lg:text-lg">
                      {entry.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="px-4">{more}</div>
          </div>

          <div role="tabpanel" className="panel min-h-0">
            <div className="absolute top-6 left-6 z-10 flex gap-1 sm:top-8 sm:left-8 lg:left-12">
              {items.map((entry, i) => (
                <Step
                  key={entry.key}
                  progress={scrollYProgress}
                  index={i}
                  count={items.length}
                  onClick={() => jump(i)}
                />
              ))}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={item.key}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16, transition: { duration: 0.15 } }}
                transition={{ duration: 0.3 }}
                className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-6 p-6 pt-14 sm:p-8 sm:pt-16 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-1 lg:items-center lg:gap-10 lg:p-12"
              >
                <div>
                  <h3 className="t-h2 max-w-[16ch] text-balance text-foreground">{item.title}</h3>
                  <Link
                    href={item.href}
                    className="group mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-signal"
                  >
                    {cta}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </div>
                <div aria-hidden className="relative h-full max-h-80 min-h-56 text-foreground">
                  {item.picture}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
