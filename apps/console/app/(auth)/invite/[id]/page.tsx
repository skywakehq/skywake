import { headers } from "next/headers";
import { AcceptInvite } from "@/features/auth/invite";
import { auth } from "@/server/auth";
import { authPool } from "@/server/db";

// The link is the secret, so whoever holds it may see whom it invites to what.
export default async function Page({ params }: PageProps<"/invite/[id]">) {
  const { id } = await params;
  const { rows } = await authPool.query<{ email: string; org: string; inviter: string }>(
    `SELECT i.email, o.name AS org, u.name AS inviter
       FROM invitation i
       JOIN organization o ON o.id = i."organizationId"
       JOIN "user" u ON u.id = i."inviterId"
      WHERE i.id = $1 AND i.status = 'pending' AND i."expiresAt" > now()`,
    [id],
  );
  const session = await auth.api.getSession({ headers: await headers() });
  return <AcceptInvite id={id} invite={rows[0] ?? null} signedInAs={session?.user.email ?? null} />;
}
