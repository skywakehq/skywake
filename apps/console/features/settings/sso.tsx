"use client";

import { Check, ChevronDown, Copy, KeyRound, Plus, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Choice, Field, Input, cx } from "@/components/kit";
import {
  act,
  Actions,
  copy,
  FormDialog,
  Glyph,
  Lines,
  Remove,
  Row,
  Section,
  Tag,
} from "./settings";
import { withBase } from "@/lib/zone";

type Connection = {
  id: string;
  type: "saml" | "oidc";
  domains: string[];
  issuer: string;
  verified: boolean;
  enabled: boolean;
  required: boolean;
  dns: { name: string; value: string }[] | null;
  sp: Record<string, string>;
  clientId?: string;
};

type Check = { name: string; ok: boolean; detail: string };

async function send(path: string, method: string, body?: unknown) {
  const response = await fetch(withBase(path), {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

/** Single sign-on connections. Only admins see this part. */
export function SingleSignOn() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    () =>
      fetch(withBase("/api/sso"))
        .then((response) => (response.ok ? response.json() : null))
        .then(setConnections),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  if (connections === null) return null;
  return (
    <Section
      id="sso"
      title="Single sign-on"
      description="Sign people in through Okta, Entra ID, Google or any SAML or OIDC provider."
      action={
        <Button leadingIcon={Plus} onClick={() => setAdding(true)}>
          New connection
        </Button>
      }
    >
      {connections.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No connections yet.</p>
      )}
      {connections.map((connection) => (
        <ConnectionRow key={connection.id} connection={connection} onChange={load} />
      ))}
      <NewConnection open={adding} onOpenChange={setAdding} onMade={load} />
    </Section>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span className={cx("size-1.5 rounded-full", on ? "bg-green" : "bg-muted-foreground/40")} />
  );
}

function ConnectionRow({
  connection: c,
  onChange,
}: {
  connection: Connection;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(!c.enabled);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const run = (action: () => Promise<unknown>) => act(action).then(onChange);
  const path = `/api/sso/${c.id}`;

  return (
    <div>
      <Row>
        <Glyph icon={KeyRound} />
        <Lines
          title={
            <>
              {c.domains.join(", ")}
              <Tag>{c.type === "saml" ? "SAML" : "OIDC"}</Tag>
              {c.required && <Tag>Required</Tag>}
              <Dot on={c.enabled} />
              <span className="text-[13px] font-normal text-muted-foreground">
                {c.enabled ? "On" : c.verified ? "Off" : "Domain not verified"}
              </span>
            </>
          }
          detail={c.issuer}
        />
        <Button
          variant="plain"
          trailingIcon={ChevronDown}
          onClick={() => setOpen(!open)}
          className="text-muted-foreground"
        >
          {open ? "Less" : "Details"}
        </Button>
        <Remove label="Delete connection" onClick={() => run(() => send(path, "DELETE"))} />
      </Row>
      {open && (
        <div className="grid gap-5 px-4 pt-1 pb-5 pl-[66px] text-sm">
          <Values
            title={
              c.type === "saml"
                ? "Copy into your identity provider"
                : "Add to the app in your identity provider"
            }
            values={c.sp}
          />
          {c.clientId && <Values title="Client" values={{ "Client ID": c.clientId }} />}
          {c.dns && (
            <div className="grid gap-2">
              <Values
                title="Prove you own the domain with a DNS TXT record"
                values={Object.fromEntries(
                  c.dns.flatMap((r) => [
                    [`Name`, r.name],
                    ["Value", r.value],
                  ]),
                )}
              />
              <div>
                <Button onClick={() => run(() => send(`${path}?do=verify`, "POST"))}>
                  Check DNS
                </Button>
              </div>
            </div>
          )}
          {checks && (
            <ul className="grid gap-1.5">
              {checks.map((check) => (
                <li key={check.name} className="flex items-start gap-2">
                  {check.ok ? (
                    <Check className="mt-0.5 size-4 text-green" />
                  ) : (
                    <X className="mt-0.5 size-4 text-red" />
                  )}
                  <span>
                    {check.name}
                    <span className="text-muted-foreground"> · {check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                act(async () => setChecks((await send(`${path}?do=test`, "POST")).checks))
              }
            >
              Test
            </Button>
            <Button
              variant={c.enabled ? "ghost" : "primary"}
              disabled={!c.verified}
              onClick={() => run(() => send(path, "PATCH", { enabled: !c.enabled }))}
            >
              {c.enabled ? "Turn off" : "Turn on"}
            </Button>
            <Button
              disabled={!c.enabled}
              onClick={() =>
                run(async () => {
                  await send(path, "PATCH", { required: !c.required });
                  toast.success(
                    c.required
                      ? "Passwords work again for these domains"
                      : "Only SSO signs these domains in now",
                  );
                })
              }
            >
              {c.required ? "Stop requiring SSO" : "Require SSO"}
            </Button>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Requiring SSO turns off passwords and passkeys for {c.domains.join(", ")} and signs out
            sessions that did not come through it. API keys keep working.
          </p>
        </div>
      )}
    </div>
  );
}

function Values({ title, values }: { title: string; values: Record<string, string> }) {
  return (
    <div className="grid gap-1.5">
      <div className="text-[13px] text-muted-foreground">{title}</div>
      {Object.entries(values).map(([name, value], index) => (
        <div key={`${name}-${index}`} className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-muted-foreground">{name}</span>
          <code className="rounded-md min-w-0 flex-1 truncate bg-muted/50 px-2 py-1 font-mono text-[12px]">
            {value}
          </code>
          <Button
            variant="plain"
            size="icon-sm"
            aria-label={`Copy ${name}`}
            onClick={() => copy(value, name)}
          >
            <Copy />
          </Button>
        </div>
      ))}
    </div>
  );
}

type Kind = "saml" | "oidc";
const KINDS: { value: Kind; label: string }[] = [
  { value: "saml", label: "SAML" },
  { value: "oidc", label: "OIDC" },
];

function NewConnection({
  open,
  onOpenChange,
  onMade,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMade: () => void;
}) {
  const [kind, setKind] = useState<Kind>("saml");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    const ok = await act(() => send("/api/sso", "POST", { type: kind, ...form }));
    setBusy(false);
    if (ok) {
      onOpenChange(false);
      onMade();
      toast.success("Connection added", { description: "Copy its values into your provider." });
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New SSO connection"
      description="People with these email domains can sign in through your identity provider."
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Protocol">
          <Choice value={kind} options={KINDS} onChange={setKind} />
        </Field>
        <Field label="Email domains">
          <Input name="domains" placeholder="example.com" required autoFocus />
        </Field>
        {kind === "saml" ? (
          <Field label="IdP metadata URL, or the metadata XML">
            <textarea
              name="metadata"
              required
              rows={4}
              placeholder="https://example.okta.com/app/…/sso/saml/metadata"
              className="w-full border border-border bg-transparent px-3 py-2 font-mono text-[12px] outline-none placeholder:text-muted-foreground hover:bg-hover focus:border-foreground/40"
            />
          </Field>
        ) : (
          <>
            <Field label="Issuer URL">
              <Input name="issuer" placeholder="https://accounts.google.com" required />
            </Field>
            <Field label="Client ID">
              <Input name="clientId" required />
            </Field>
            <Field label="Client secret">
              <Input name="clientSecret" type="password" autoComplete="off" required />
            </Field>
          </>
        )}
        <Actions submit="Add connection" busy={busy} />
      </form>
    </FormDialog>
  );
}
