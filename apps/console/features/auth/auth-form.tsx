"use client";

import { useSearchParams } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { type ComponentProps, type FormEvent, type ReactNode, useState } from "react";
import { cx } from "@/components/kit";
import { withBase } from "@/lib/zone";

/** A form that shows the error its action throws, and waits while it runs. */
export function AuthForm({
  title,
  lead,
  submit = "Continue",
  action,
  before,
  children,
}: {
  title: string;
  lead?: ReactNode;
  submit?: string;
  action: (form: FormData) => Promise<void>;
  /** Shown between the title and the fields, like the provider buttons. */
  before?: ReactNode;
  children?: ReactNode;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await action(new FormData(event.currentTarget));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <AuthTitle lead={lead}>{title}</AuthTitle>
      {before}
      {children}
      {error && <p className="text-[13px] text-red">{error}</p>}
      <AuthButton variant="primary" disabled={busy}>
        {submit}
      </AuthButton>
    </form>
  );
}

export function AuthTitle({ lead, children }: { lead?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-3 grid gap-2">
      <h1 className="text-[28px] leading-[1.1] font-medium tracking-[-0.03em] text-foreground">
        {children}
      </h1>
      {lead && <p className="text-[14px] leading-[1.5] text-muted-foreground">{lead}</p>}
    </div>
  );
}

export function AuthField({
  label,
  aside,
  ...input
}: { label: string; aside?: ReactNode } & ComponentProps<"input">) {
  return (
    <label className="grid gap-2">
      <span className="flex items-baseline justify-between text-[13px] text-muted-foreground">
        {label}
        {aside}
      </span>
      <input
        {...input}
        className={cx(
          "h-[44px] w-full rounded-md border border-border bg-transparent px-3 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:border-foreground/30 focus:border-foreground",
          input.className,
        )}
      />
    </label>
  );
}

const BUTTON =
  "inline-flex h-[44px] w-full items-center justify-center gap-1.5 rounded-md px-4 text-[14px] transition disabled:opacity-50";
const VARIANTS = {
  primary: "bg-foreground text-background hover:opacity-85",
  outline: "border border-border text-foreground hover:bg-foreground/5",
  quiet: "border border-border text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
};

/** The landing page's buttons: a solid one with its arrow, and outlined ones. */
export function AuthButton({
  variant = "outline",
  className,
  children,
  ...props
}: { variant?: keyof typeof VARIANTS } & ComponentProps<"button">) {
  return (
    <button className={cx(BUTTON, VARIANTS[variant], className)} {...props}>
      {children}
      {variant === "primary" && <ArrowUpRight className="size-3.5" />}
    </button>
  );
}

export function authButton(variant: keyof typeof VARIANTS = "outline") {
  return cx(BUTTON, VARIANTS[variant]);
}

/** A line under the form, like "New here? Create an account". */
export function AuthFooter({ children }: { children: ReactNode }) {
  return <p className="mt-8 text-[13px] text-muted-foreground">{children}</p>;
}

export const authLink = "text-foreground underline-offset-4 hover:underline";

/** Better Auth returns errors instead of throwing them. */
export function check<T>(
  result: { data: T; error: null } | { data: null; error: { message?: string; code?: string } },
) {
  if (result.error || result.data == null) {
    const message = result.error?.code === "EMAIL_NOT_VERIFIED" ? UNVERIFIED : undefined;
    throw new Error(message ?? result.error?.message ?? "Something went wrong");
  }
  return result.data as NonNullable<T>;
}

const UNVERIFIED = "Verify your email first. We sent you a new link.";

/** A link to another sign-in page that keeps where to go after. */
export function useKeepNext() {
  const after = useSearchParams().get("next");
  return (path: string) => (after ? `${path}?next=${encodeURIComponent(after)}` : path);
}

export function next() {
  return withBase(new URLSearchParams(location.search).get("next") ?? "/");
}
