import { z } from "zod";
import { admin, create, list } from "@/server/sso";

const NewConnection = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("saml"),
    domains: z.string(),
    metadata: z.string().min(1).max(100_000),
  }),
  z.object({
    type: z.literal("oidc"),
    domains: z.string(),
    issuer: z.string().min(1).max(2000),
    clientId: z.string().min(1).max(500),
    clientSecret: z.string().min(1).max(2000),
  }),
]);

// The organization's single sign-on connections. Admins only.
export async function GET(request: Request) {
  return admin(request, (who) => list(who, request.headers));
}

export async function POST(request: Request) {
  return admin(request, async (who) => {
    const input = NewConnection.parse(await request.json());
    return { id: await create(who, request.headers, input) };
  });
}
