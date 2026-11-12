"use client";

import { ArrowUpRight, Check } from "lucide-react";
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
      <p className="t-body flex items-center gap-2 text-foreground">
        <Check className="size-4 text-signal" />
        You&apos;re on the list. We&apos;ll email you when Cloud opens.
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      <input
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@company.com"
        aria-label="Email"
        className="field"
      />
      <input
        name="use"
        maxLength={500}
        placeholder="What will you build? (optional)"
        aria-label="What will you build?"
        className="field"
      />
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      {state.status !== "idle" && (
        <p role="alert" className="t-mono text-signal">
          {messages[state.status]}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary w-fit disabled:opacity-60"
      >
        {pending ? "Joining…" : "Join the waitlist"} <ArrowUpRight className="size-3.5" />
      </button>
    </form>
  );
}
