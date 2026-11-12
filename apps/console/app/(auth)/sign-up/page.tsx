"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  AuthField,
  AuthFooter,
  AuthForm,
  authLink,
  check,
  next,
  useKeepNext,
} from "@/features/auth/auth-form";
import { authClient } from "@/features/auth/auth-client";
import { CheckEmail } from "@/features/auth/check-email";
import { SocialButtons } from "@/features/auth/social";

export default function Page() {
  return (
    <Suspense>
      <SignUp />
    </Suspense>
  );
}

function SignUp() {
  const keepNext = useKeepNext();
  // An invitation's link fills in the email it was sent to.
  const invited = useSearchParams().get("email") ?? "";
  const [sent, setSent] = useState("");

  async function signUp(form: FormData) {
    const email = String(form.get("email"));
    const result = check(
      await authClient.signUp.email({
        name: String(form.get("name")),
        email,
        password: String(form.get("password")),
        callbackURL: new URL(next(), location.origin).href,
      }),
    );
    // No session yet means the email must be verified first.
    if (!result.token) return setSent(email);
    location.assign(next());
  }

  if (sent) return <CheckEmail email={sent} />;

  return (
    <>
      <AuthForm title="Create your account" action={signUp} before={<SocialButtons />}>
        <AuthField label="Name" name="name" autoComplete="name" required autoFocus />
        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          defaultValue={invited}
          required
        />
        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          minLength={8}
          required
        />
      </AuthForm>
      <AuthFooter>
        Have an account?{" "}
        <Link href={keepNext("/sign-in")} className={authLink}>
          Sign in
        </Link>
      </AuthFooter>
    </>
  );
}
