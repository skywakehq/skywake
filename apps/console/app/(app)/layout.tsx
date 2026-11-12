import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Console } from "@/components/shell/console";
import { AuthOptionsProvider } from "@/features/auth/options";
import { auth } from "@/server/auth";
import { membershipOf } from "@/server/membership";
import { authOptions } from "@/server/hosted";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/sign-in");
  let org = session.session.activeOrganizationId;
  if (!org) {
    const orgs = await auth.api.listOrganizations({ headers: requestHeaders });
    if (!orgs.length) redirect("/onboarding");
    org = orgs[0].id;
    await auth.api.setActiveOrganization({
      headers: requestHeaders,
      body: { organizationId: org },
    });
  }
  // The sidebar remembers whether it was open in a cookie.
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const { id, name, email } = session.user;
  const member = await membershipOf(() =>
    auth.api.getActiveMember({ headers: requestHeaders }),
  );
  const role = member?.role ?? "member";
  return (
    <AuthOptionsProvider value={authOptions()}>
      <Console
        user={{ id, name, email }}
        org={org}
        role={role}
        urls={{ zero: process.env.PUBLIC_ZERO_URL!, api: process.env.PUBLIC_API_URL! }}
        sidebarOpen={sidebarOpen}
      >
        {children}
      </Console>
    </AuthOptionsProvider>
  );
}
