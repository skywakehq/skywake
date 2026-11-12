import { z } from "zod";
import { admin, remove, test, update, verify } from "@/server/sso";

type Params = { params: Promise<{ id: string }> };

const Change = z.object({ enabled: z.boolean().optional(), required: z.boolean().optional() });

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return admin(request, async (who) => update(who, id, Change.parse(await request.json())));
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return admin(request, (who) => remove(who, request.headers, id));
}

// POST ?do=verify checks the DNS record; ?do=test checks the connection can work.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const action = new URL(request.url).searchParams.get("do");
  return admin(request, async (who) => {
    if (action === "verify") return verify(who, request.headers, id);
    if (action === "test") return { checks: await test(who, id) };
    throw new Error("Use ?do=verify or ?do=test");
  });
}
