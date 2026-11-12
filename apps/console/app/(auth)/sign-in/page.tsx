"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import {
  AuthButton,
  AuthField,
  AuthFooter,
  AuthForm,
  authLink,
  check,
  next,
  useKeepNext,
} from "@/features/auth/auth-form";
import { useAuthOptions } from "@/features/auth/options";
import { SocialButtons } from "@/features/auth/social";
import { authClient } from "@/features/auth/auth-client";
import { authError } from "@/lib/auth-error";
import { withBase } from "@/lib/zone";

type Sso = { domain: string; sso: boolean; required: boolean };

// A local test user, filled in for you in development only. Set it in
// apps/console/.env.development.local, which git ignores.
const DEV_USER = {
  email: process.env.NEXT_PUBLIC_DEV_EMAIL ?? "",
  password: process.env.NEXT_PUBLIC_DEV_PASSWORD ?? "",
};

export default function Page() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  const [email, setEmail] = useState(DEV_USER.email);
  const [found, setFound] = useState<Sso | null>(null);
  // An SSO sign-in that failed comes back here with why.
  const query = useSearchParams();
  const failed = authError(new URLSearchParams(query.toString()));
  const { email: emailOn } = useAuthOptions();
  const keepNext = useKeepNext();

  // Ask once the email has a domain, and again only when the domain changes.
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  useEffect(() => {
    if (!domain.includes(".")) return;
    const wait = setTimeout(() => {
      fetch(withBase(`/api/sso/discover?email=${encodeURIComponent(`x@${domain}`)}`))
        .then((response) => response.json())
        .then((answer) => setFound({ domain, ...answer }))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(wait);
  }, [domain]);
  const sso = found?.domain === domain ? found : { sso: false, required: false };

  async function withPassword(form: FormData) {
    check(
      await authClient.signIn.email({
        email: String(form.get("email")),
        password: String(form.get("password")),
      }),
    );
    location.assign(next());
  }

  async function withSso() {
    const target = new URL(next(), location.origin).href;
    const { url } = check(
      await authClient.signIn.sso({
        email,
        callbackURL: target,
        errorCallbackURL: `${location.origin}${withBase("/sign-in")}`,
      }),
    );
    location.assign(url);
  }

  async function withPasskey() {
    const result = await authClient.signIn.passkey();
    if (!result?.error) location.assign(next());
  }

  const emailField = (
    <AuthField
      label="Email"
      name="email"
      type="email"
      value={email}
      onChange={(event) => setEmail(event.target.value)}
      autoComplete={sso.required ? "username" : "username webauthn"}
      placeholder="you@company.com"
      required
      autoFocus
    />
  );

  if (sso.required) {
    return (
      <AuthForm
        title="Sign in"
        lead="Your organization signs you in through its identity provider."
        submit="Continue with SSO"
        action={withSso}
      >
        {emailField}
        {failed && <p className="text-[13px] text-red">{failed}</p>}
      </AuthForm>
    );
  }

  return (
    <>
      <AuthForm
        title="Sign in"
        lead={
          query.has("reset") ? "Your password is changed. Sign in with the new one." : undefined
        }
        action={withPassword}
        before={<SocialButtons />}
      >
        {emailField}
        <AuthField
          label="Password"
          aside={
            emailOn && (
              <Link href="/forgot-password" className="hover:text-foreground">
                Forgot?
              </Link>
            )
          }
          name="password"
          type="password"
          defaultValue={DEV_USER.password}
          autoComplete="current-password"
          required
        />
        {failed && <p className="text-[13px] text-red">{failed}</p>}
      </AuthForm>
      <div className="mt-3 grid gap-3">
        {sso.sso && (
          <AuthButton type="button" onClick={withSso}>
            Continue with SSO
          </AuthButton>
        )}
        <AuthButton type="button" variant="quiet" onClick={withPasskey}>
          <Fingerprint className="size-4" />
          Sign in with a passkey
        </AuthButton>
      </div>
      <AuthFooter>
        New here?{" "}
        <Link href={keepNext("/sign-up")} className={authLink}>
          Create an account
        </Link>
      </AuthFooter>
    </>
  );
}
