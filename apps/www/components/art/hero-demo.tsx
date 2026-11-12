"use client";

import { useEffect, useState } from "react";

import type { HomeMessages } from "@/content/messages";

export function HeroDemo({ messages }: { messages: HomeMessages }) {
  const steps = messages.demo.steps;
  const agents = messages.demo.agents;
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setStep((v) => (v + 1) % steps.length), 3200);
    return () => clearInterval(t);
  }, [steps.length]);

  const current = steps[step]!;

  return (
    <div className="grid overflow-hidden lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <div className="flex flex-col border-b border-border p-5 sm:p-7 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3">
          <p className="t-eyebrow text-muted-foreground">{messages.demo.workspace}</p>
          <p className="t-mono text-muted-foreground">{messages.demo.storage}</p>
        </div>

        <ul className="mt-5 grid gap-2">
          {agents.map((agent) => {
            const highlighted = agent.id === current.focus;
            return (
              <li
                key={agent.id}
                className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 ring-1 transition-colors duration-500 ${
                  highlighted
                    ? "bg-[color-mix(in_oklab,var(--signal)_10%,var(--background))] ring-signal/40"
                    : "bg-background ring-border"
                }`}
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    highlighted ? "bg-signal" : "bg-muted-foreground/35"
                  }`}
                />
                <span className="t-mono text-foreground">{agent.id}</span>
                <span className="t-mono ml-auto text-muted-foreground">
                  {highlighted ? current.label.toLowerCase() : agent.idle}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="t-small mt-auto pt-6 text-muted-foreground">{messages.demo.branchNote}</p>
      </div>

      <div className="flex flex-col bg-[color-mix(in_oklab,var(--foreground)_2.5%,var(--card))] p-5 sm:p-7">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={messages.demo.workspace}>
          {steps.map((item, i) => (
            <button
              key={item.label}
              type="button"
              role="tab"
              aria-selected={i === step}
              onClick={() => setStep(i)}
              className={`t-mono rounded-full px-3 py-1.5 transition-colors ${
                i === step
                  ? "bg-foreground text-background"
                  : "bg-background text-muted-foreground ring-1 ring-border hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div key={current.label} className="rise-in mt-6">
          <p className="t-h3 text-foreground">{current.detail}</p>
          <div className="mt-4 overflow-hidden rounded-2xl bg-background ring-1 ring-border">
            <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
              <span className="size-2 rounded-full bg-muted-foreground/30" />
              <span className="size-2 rounded-full bg-muted-foreground/30" />
              <span className="size-2 rounded-full bg-muted-foreground/30" />
              <span className="t-mono ml-2 text-muted-foreground">{messages.demo.terminal}</span>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-6 sm:text-[13px]">
              <code>
                <span className="text-muted-foreground">$ </span>
                <span className="text-foreground">{current.cmd}</span>
                {"\n"}
                <span className="text-signal">{current.result}</span>
              </code>
            </pre>
          </div>
        </div>

        <p className="t-small mt-auto pt-6 text-muted-foreground">{messages.demo.bucketNote}</p>
      </div>
    </div>
  );
}
