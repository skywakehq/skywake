"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient } from "./auth-client";
import { AuthField, AuthFooter, AuthForm, authLink, AuthTitle, check } from "./auth-form";
import { withBase } from "@/lib/zone";

export function ForgotPassword() {
  const [sent, setSent] = useState("");

  async function request(form: FormData) {
    const email = String(form.get("email"));
    check(
      await authClient.requestPasswordReset({ email, redirectTo: withBase("/reset-password") }),
    );
    setSent(email);
  }

  if (sent) {
    return (
      <>
        <AuthTitle
          lead={
            <>
              If <span className="text-foreground">{sent}</span> has an account, we sent it a link
              to choose a new password.
            </>
          }
        >
          Check your email
        </AuthTitle>
        <BackToSignIn />
      </>
    );
  }

  return (
    <>
      <AuthForm
        title="Reset your password"
        lead="We’ll email you a link to choose a new one."
        submit="Send reset link"
        action={request}
      >
        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          autoFocus
        />
      </AuthForm>
      <BackToSignIn />
    </>
  );
}

export function ResetPassword() {
  const query = useSearchParams();
  const token = query.get("token");

  async function reset(form: FormData) {
    check(
      await authClient.resetPassword({ newPassword: String(form.get("password")), token: token! }),
    );
    location.assign(withBase("/sign-in?reset=1"));
  }

  if (!token) {
    return (
      <>
        <AuthTitle
          lead={`${
            query.get("error") === "INVALID_TOKEN"
              ? "It was used already or is more than an hour old."
              : "It is missing its token."
          } Ask for a new one.`}
        >
          This link doesn’t work
        </AuthTitle>
        <AuthFooter>
          <Link href="/forgot-password" className={authLink}>
            Reset your password
          </Link>
        </AuthFooter>
      </>
    );
  }

  return (
    <AuthForm title="Choose a new password" submit="Change password" action={reset}>
      <AuthField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="At least 8 characters"
        minLength={8}
        required
        autoFocus
      />
    </AuthForm>
  );
}

function BackToSignIn() {
  return (
    <AuthFooter>
      <Link href="/sign-in" className={authLink}>
        Back to sign in
      </Link>
    </AuthFooter>
  );
}
