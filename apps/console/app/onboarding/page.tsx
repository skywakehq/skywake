"use client";

import { AuthForm, check } from "@/features/auth/auth-form";
import { Logo } from "@skywake/ui/components/logo";
import { Field, Input } from "@/components/kit";
import { authClient } from "@/features/auth/auth-client";
import { withBase } from "@/lib/zone";

function slug(name: string) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "org";
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function Onboarding() {
  async function create(form: FormData) {
    const name = String(form.get("name"));
    const org = check(await authClient.organization.create({ name, slug: slug(name) }));
    check(await authClient.organization.setActive({ organizationId: org.id }));
    location.assign(withBase("/"));
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-[340px]">
        <Logo className="mb-8 size-6" />
        <AuthForm title="Name your organization" submit="Create organization" action={create}>
          <p className="-mt-2 text-sm text-muted-foreground">
            Your team, its environments and its agents live here.
          </p>
          <Field label="Name">
            <Input name="name" placeholder="Acme" required autoFocus />
          </Field>
        </AuthForm>
      </div>
    </main>
  );
}
