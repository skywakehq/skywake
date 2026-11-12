import { ssoOrgsFor } from "@/server/sso-policy";
import { auth } from "@/server/auth";

// Tells the sign-in page whether an email signs in with SSO, and whether it must.
export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email") ?? "";
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return Response.json({ sso: false, required: false });
  const ctx = await auth.$context;
  const providers = await ctx.adapter.findMany<{ domain: string; domainVerified: boolean }>({
    model: "ssoProvider",
    where: [{ field: "enabled", value: true }],
  });
  const sso = providers.some(
    (p) => p.domainVerified && p.domain.split(",").some((d) => d.trim().toLowerCase() === domain),
  );
  return Response.json({ sso, required: sso && (await ssoOrgsFor(email)).length > 0 });
}
