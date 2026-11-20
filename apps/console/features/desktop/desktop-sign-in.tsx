"use client";

import { Laptop } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button, Choice, Field, Page } from "@/components/kit";
import { authClient } from "@/features/auth/auth-client";
import { useEnvironments } from "@/features/environments/use-environments";
import { Select } from "@/features/indexes/fields";
import { act } from "@/features/settings/settings";
import { useEnvironment } from "@/hooks/use-ns";
import { withBase } from "@/lib/zone";

type Access = "read" | "write" | "admin";

const ACCESS: { value: Access; label: string }[] = [
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
  { value: "admin", label: "Admin" },
];

// The API checks both again (`packages/contract/src/oauth.ts`).
const DESKTOP_CLIENT = "skywake-desktop";
const DESKTOP_REDIRECT = /^http:\/\/127\.0\.0\.1:(\d{2,5})\/callback$/;

const EVERY = "";
const TITLE = "Sign in Skywake for Mac";
const EYEBROW = "Desktop app";

type Asked = {
  redirect: string;
  state: string;
  challenge: string;
  device: string;
  org: string | null;
};

/** What the app put in the address, or null when it is not a sign-in it could have sent. */
function asked(search: string): Asked | null {
  const query = new URLSearchParams(search);
  const redirect = query.get("redirect_uri") ?? "";
  const state = query.get("state") ?? "";
  const challenge = query.get("code_challenge") ?? "";
  const valid =
    query.get("client_id") === DESKTOP_CLIENT &&
    query.get("response_type") === "code" &&
    query.get("code_challenge_method") === "S256" &&
    DESKTOP_REDIRECT.test(redirect) &&
    /^[A-Za-z0-9_-]{43}$/.test(challenge) &&
    /^[A-Za-z0-9_-]{16,128}$/.test(state);
  if (!valid) return null;
  const device = (query.get("device") ?? "").trim().slice(0, 64) || "this Mac";
  return { redirect, state, challenge, device, org: query.get("org") };
}

/** Back to the app, which checks `state` before it trusts anything here. */
function back(to: Asked, answer: Record<string, string>) {
  const url = new URL(to.redirect);
  for (const [name, value] of Object.entries({ ...answer, state: to.state })) {
    url.searchParams.set(name, value);
  }
  location.assign(url.href);
}

const still = () => () => {};

export function DesktopSignIn() {
  // The address is only known in the browser; null while rendering on the server.
  const search = useSyncExternalStore(
    still,
    () => location.search,
    () => null,
  );
  const request = useMemo(() => (search === null ? undefined : asked(search)), [search]);

  if (request === undefined)
    return (
      <Page narrow eyebrow={EYEBROW} title={TITLE}>
        {null}
      </Page>
    );
  if (request === null)
    return (
      <Page
        narrow
        eyebrow={EYEBROW}
        title="This link is not complete"
        description="Open Skywake on your Mac and choose Sign in there."
      >
        {null}
      </Page>
    );
  return <Asking request={request} />;
}

function Asking({ request }: { request: Asked }) {
  const { data: orgs } = authClient.useListOrganizations();
  const { data: active } = authClient.useActiveOrganization();
  const { data: member } = authClient.useActiveMember();
  const { envs } = useEnvironments();
  const current = useEnvironment();
  const [busy, setBusy] = useState(false);

  // The app asks for an organization when you switch to one there.
  const wanted = request.org;
  useEffect(() => {
    if (!wanted || !active || active.id === wanted) return;
    if (!orgs?.some((org) => org.id === wanted)) return;
    void authClient.organization
      .setActive({ organizationId: wanted })
      .then(() => location.reload());
  }, [wanted, active, orgs]);

  const top: Access = member?.role === "owner" || member?.role === "admin" ? "admin" : "write";
  const roles = ACCESS.slice(0, ACCESS.findIndex((a) => a.value === top) + 1);
  const [role, setRole] = useState<Access>("write");
  const everyEnvironment = top === "admin";
  const fallback = current ?? envs[0]?.name ?? (everyEnvironment ? EVERY : "default");
  const choices = useMemo(() => orgs ?? [], [orgs]);

  async function switchTo(id: string) {
    await authClient.organization.setActive({ organizationId: id });
    location.reload();
  }

  async function allow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = String(new FormData(event.currentTarget).get("environment") ?? EVERY);
    const environment = chosen === EVERY ? null : chosen;
    setBusy(true);
    let code = "";
    const ok = await act(async () => {
      const response = await fetch(withBase("/api/desktop"), {
        method: "POST",
        body: JSON.stringify({
          client_id: DESKTOP_CLIENT,
          redirect_uri: request.redirect,
          code_challenge: request.challenge,
          code_challenge_method: "S256",
          device: request.device,
          environment,
          role: roles.some((r) => r.value === role) ? role : "read",
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(data?.error?.message ?? data?.error ?? "Could not allow the app");
      code = data.code;
    });
    if (ok && code) back(request, { code });
    else setBusy(false);
  }

  return (
    <Page
      narrow
      eyebrow={EYEBROW}
      title={TITLE}
      description={`Skywake on ${request.device} asks to use your disks. It gets a key of its own that you can remove in Settings at any time.`}
    >
      <form onSubmit={allow} className="grid max-w-md gap-6">
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
          <Laptop className="size-4 text-muted-foreground" />
          <span className="text-sm">{request.device}</span>
        </div>
        {choices.length > 1 && (
          <Field label="Organization">
            <Select
              value={active?.id ?? ""}
              onChange={(event) => void switchTo(event.currentTarget.value)}
            >
              {choices.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Environment">
          <Select name="environment" defaultValue={fallback} key={fallback}>
            {everyEnvironment && <option value={EVERY}>Every environment</option>}
            {envs.map((env) => (
              <option key={env.name} value={env.name}>
                {env.name}
              </option>
            ))}
            {envs.length === 0 && <option value="default">default</option>}
          </Select>
        </Field>
        <Field label="Access">
          <Choice value={role} options={roles} onChange={setRole} />
        </Field>
        <div className="flex gap-2">
          <Button size="default" variant="primary" disabled={busy}>
            Allow
          </Button>
          <Button
            size="default"
            type="button"
            disabled={busy}
            onClick={() => back(request, { error: "access_denied" })}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Page>
  );
}
