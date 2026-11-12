"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { authClient } from "./auth-client";
import { AuthButton, authButton, AuthForm, AuthTitle, check } from "./auth-form";
import { withBase } from "@/lib/zone";

type Invite = { email: string; org: string; inviter: string };

/** Joins an organization, after signing in or up as the invited email. */
export function AcceptInvite({
  id,
  invite,
  signedInAs,
}: {
  id: string;
  invite: Invite | null;
  signedInAs: string | null;
}) {
  if (!invite) {
    return (
      <AuthTitle lead="It was accepted, cancelled or is past its date. Ask whoever invited you for a new one.">
        This invitation is closed
      </AuthTitle>
    );
  }

  const here = `/invite/${id}`;
  const title = `Join ${invite.org}`;
  const detail: ReactNode = (
    <>
      {invite.inviter} invited <span className="text-foreground">{invite.email}</span> to work with
      them on Skywake.
    </>
  );

  if (!signedInAs) {
    const after = `?next=${encodeURIComponent(here)}`;
    return (
      <div className="grid gap-3">
        <AuthTitle lead={detail}>{title}</AuthTitle>
        <Link
          href={`/sign-up${after}&email=${encodeURIComponent(invite.email)}`}
          className={authButton("primary")}
        >
          Create an account <ArrowUpRight className="size-3.5" />
        </Link>
        <Link href={`/sign-in${after}`} className={authButton()}>
          I have an account
        </Link>
      </div>
    );
  }

  if (signedInAs.toLowerCase() !== invite.email.toLowerCase()) {
    async function switchAccount() {
      await authClient.signOut();
      location.assign(withBase(`/sign-in?next=${encodeURIComponent(here)}`));
    }
    return (
      <div className="grid gap-3">
        <AuthTitle
          lead={
            <>
              This invitation is for <span className="text-foreground">{invite.email}</span>, and
              you are signed in as <span className="text-foreground">{signedInAs}</span>.
            </>
          }
        >
          {title}
        </AuthTitle>
        <AuthButton type="button" onClick={switchAccount}>
          Sign in as {invite.email}
        </AuthButton>
      </div>
    );
  }

  async function accept() {
    const result = check(await authClient.organization.acceptInvitation({ invitationId: id }));
    check(
      await authClient.organization.setActive({ organizationId: result.invitation.organizationId }),
    );
    location.assign(withBase("/"));
  }

  return <AuthForm title={title} lead={detail} submit="Accept invitation" action={accept} />;
}
