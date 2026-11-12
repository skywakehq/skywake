"use client";

import { useState } from "react";
import { authClient } from "./auth-client";
import { AuthButton, AuthTitle, next } from "./auth-form";

/** Shown after sign-up when the email must be verified before signing in. */
export function CheckEmail({ email }: { email: string }) {
  const [resent, setResent] = useState(false);

  async function resend() {
    await authClient.sendVerificationEmail({
      email,
      callbackURL: new URL(next(), location.origin).href,
    });
    setResent(true);
  }

  return (
    <div className="grid gap-5">
      <AuthTitle
        lead={
          <>
            We sent a link to <span className="text-foreground">{email}</span>. Open it to verify
            your email and finish signing up.
          </>
        }
      >
        Check your email
      </AuthTitle>
      <AuthButton type="button" onClick={resend} disabled={resent}>
        {resent ? "Sent again" : "Send the link again"}
      </AuthButton>
    </div>
  );
}
