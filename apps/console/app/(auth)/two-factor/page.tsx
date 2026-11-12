"use client";

import { AuthField, AuthForm, check, next } from "@/features/auth/auth-form";
import { authClient } from "@/features/auth/auth-client";

export default function TwoFactor() {
  async function verify(form: FormData) {
    check(await authClient.twoFactor.verifyTotp({ code: String(form.get("code")) }));
    location.assign(next());
  }

  return (
    <AuthForm
      title="Enter your code"
      lead="The six digits from your authenticator app."
      action={verify}
    >
      <AuthField
        label="Code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        required
        autoFocus
        className="font-mono tracking-[0.3em]"
      />
    </AuthForm>
  );
}
