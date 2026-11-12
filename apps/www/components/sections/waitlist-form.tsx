"use client";

import { ArrowRight, Check } from "lucide-react";
import { useActionState } from "react";

import { joinWaitlist, type WaitlistState } from "@/server/join-waitlist";

const messages: Record<Exclude<WaitlistState["status"], "idle" | "joined">, string> = {
  invalid: "Enter a valid email address.",
  off: "The waitlist isn't open yet. Try again soon.",
  error: "Something went wrong on our side. Try again.",
};

export function WaitlistForm() {
  const [state, action, pending] = useActionState<WaitlistState, FormData>(joinWaitlist, {
    status: "idle",
  });

  if (state.status === "joined") {
    return (
      <p className="t-body flex h-14 items-center gap-2">
        <Check className="size-4" />
        You&apos;re on the list. We&apos;ll email you when Cloud opens.
      </p>
    );
  }

  return (
    <form action={action} className="w-full max-w-md">
      <div className="flex h-14 items-center gap-2 rounded-full bg-background/10 p-1.5 pl-5 ring-1 ring-background/15 focus-within:ring-background/40">
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          aria-label="Email"
          className="t-body min-w-0 flex-1 bg-transparent text-background outline-none placeholder:text-background/45"
        />
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
        <button
          type="submit"
          disabled={pending}
          className="btn h-full shrink-0 rounded-full bg-background text-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Joining…" : "Join waitlist"} <ArrowRight className="size-3.5" />
        </button>
      </div>
      {state.status !== "idle" && (
        <p role="alert" className="t-small mt-3 text-background/70">
          {messages[state.status]}
        </p>
      )}
    </form>
  );
}
