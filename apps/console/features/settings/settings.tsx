"use client";

import {
  ChevronDown,
  Copy,
  Fingerprint,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@skywake/ui/components/dialog";
import { Tooltip } from "@skywake/ui/components/tooltip";
import { authClient } from "@/features/auth/auth-client";
import { useAuthOptions } from "@/features/auth/options";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/menu";
import { Avatar, Button, Choice, Field, Input, Page, ago, cx, useNow } from "@/components/kit";
import { Billing } from "./billing";
import { IpAllowlist } from "./ip-allowlist";
import { SingleSignOn } from "./sso";
import { withBase } from "@/lib/zone";

export function SettingsPage() {
  const { data: org } = authClient.useActiveOrganization();
  return (
    <Page
      narrow
      eyebrow={org?.name ?? "Organization"}
      title="Settings"
      description="Who can reach your filesystems, and how."
    >
      <div className="grid gap-12">
        <Members />
        <Keys />
        <Security />
        <SingleSignOn />
        <IpAllowlist />
        <Billing />
      </div>
    </Page>
  );
}

/** Runs an action and shows its error, if any, as a toast. */
export async function act(action: () => Promise<unknown>) {
  try {
    const result = (await action()) as { error?: { message?: string } } | undefined;
    if (result?.error) throw new Error(result.error.message ?? "Something went wrong");
    return true;
  } catch (failure) {
    toast.error(failure instanceof Error ? failure.message : String(failure));
    return false;
  }
}

export function copy(text: string, what: string) {
  navigator.clipboard.writeText(text);
  toast.success(`${what} copied`);
}

/** A titled part of the page: heading and action on one line, then a list. */
export function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="grid scroll-mt-8 gap-4">
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      <div className="-mx-4 divide-y divide-border/60 border-y border-border/60">{children}</div>
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="flex min-h-16 items-center gap-3.5 px-4 py-3 text-sm">{children}</div>;
}

export function Lines({ title, detail }: { title: ReactNode; detail?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 truncate font-medium">{title}</div>
      {detail && <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{detail}</div>}
    </div>
  );
}

export function Glyph({ icon: Icon }: { icon: typeof Plus }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
      <Icon className="size-4" />
    </span>
  );
}

/** A small icon button for removing something, named by its tooltip. */
export function Remove({
  label,
  onClick,
  icon = Trash2,
}: {
  label: string;
  onClick: () => void;
  icon?: typeof Plus;
}) {
  const Icon = icon;
  return (
    <Tooltip content={label}>
      <Button
        variant="plain"
        size="icon-sm"
        aria-label={label}
        onClick={onClick}
        className="text-muted-foreground hover:text-destructive"
      >
        <Icon />
      </Button>
    </Tooltip>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="text-sm">{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function Actions({ submit, busy }: { submit: string; busy: boolean }) {
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button size="default" type="button">
          Cancel
        </Button>
      </DialogClose>
      <Button size="default" variant="primary" disabled={busy}>
        {submit}
      </Button>
    </DialogFooter>
  );
}

type Role = "member" | "admin";
const ROLES: { value: Role; label: string }[] = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
];

function Members() {
  const { data: org, refetch } = authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();
  const orgs = authClient.organization;
  const [inviting, setInviting] = useState(false);
  const { email: emailOn } = useAuthOptions();
  const pending = org?.invitations.filter((i) => i.status === "pending") ?? [];
  const run = (action: () => Promise<unknown>) => act(action).then(() => refetch());

  return (
    <Section
      id="members"
      title="Members"
      description="Admins can invite people, change roles and make keys."
      action={
        <Button leadingIcon={UserPlus} onClick={() => setInviting(true)}>
          Invite
        </Button>
      }
    >
      {org?.members.map((member) => (
        <Row key={member.id}>
          <Avatar name={member.user.name} className="size-9 text-xs ring-0" />
          <Lines
            title={
              <>
                {member.user.name}
                {member.userId === session?.user.id && <Tag>You</Tag>}
              </>
            }
            detail={member.user.email}
          />
          {member.role === "owner" ? (
            <span className="pr-2 text-[13px] text-muted-foreground">Owner</span>
          ) : (
            <Menu>
              <MenuTrigger asChild>
                <Button
                  variant="plain"
                  trailingIcon={ChevronDown}
                  className="text-muted-foreground"
                >
                  {member.role === "admin" ? "Admin" : "Member"}
                </Button>
              </MenuTrigger>
              <MenuContent
                align="end"
                checkedIndex={ROLES.findIndex((r) => r.value === member.role)}
              >
                {ROLES.map((role, index) => (
                  <MenuItem
                    key={role.value}
                    index={index}
                    label={role.label}
                    checked={member.role === role.value}
                    onSelect={() =>
                      run(() => orgs.updateMemberRole({ memberId: member.id, role: role.value }))
                    }
                  />
                ))}
                <MenuSeparator />
                <MenuItem
                  index={ROLES.length}
                  icon={Trash2}
                  label="Remove from organization"
                  onSelect={() => run(() => orgs.removeMember({ memberIdOrEmail: member.id }))}
                />
              </MenuContent>
            </Menu>
          )}
        </Row>
      ))}
      {pending.map((invitation) => (
        <Row key={invitation.id}>
          <span className="size-9 shrink-0 rounded-full border border-dashed" />
          <Lines
            title={<span className="font-normal text-muted-foreground">{invitation.email}</span>}
            detail={`Invited as ${invitation.role}`}
          />
          <Button
            variant="plain"
            leadingIcon={Copy}
            onClick={() =>
              copy(`${location.origin}${withBase(`/invite/${invitation.id}`)}`, "Invite link")
            }
          >
            Copy link
          </Button>
          <Remove
            label="Cancel invitation"
            icon={X}
            onClick={() => run(() => orgs.cancelInvitation({ invitationId: invitation.id }))}
          />
        </Row>
      ))}
      <Invite
        open={inviting}
        onOpenChange={setInviting}
        onDone={() => {
          refetch();
          toast.success(emailOn ? "Invitation sent" : "Invitation made", {
            description: emailOn
              ? "We emailed them a link to join."
              : "Copy its link from the list.",
          });
        }}
      />
    </Section>
  );
}

function Invite({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    setBusy(true);
    const ok = await act(() => authClient.organization.inviteMember({ email, role }));
    setBusy(false);
    if (ok) {
      onOpenChange(false);
      onDone();
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite someone"
      description="They get a link to join. Admins can invite people, change roles and make keys."
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Email">
          <Input name="email" type="email" placeholder="name@company.com" required autoFocus />
        </Field>
        <Field label="Role">
          <Choice value={role} options={ROLES} onChange={setRole} />
        </Field>
        <Actions submit="Invite" busy={busy} />
      </form>
    </FormDialog>
  );
}

type Key = {
  id: string;
  name: string;
  role: string;
  namespaces: string;
  last_used?: string | null;
  expires?: string | null;
  created_by?: string | null;
  created_by_email?: string | null;
};

/** Who made a key: a person's email, or another key. */
function maker(key: Key) {
  if (key.created_by_email) return `Made by ${key.created_by_email}`;
  if (key.created_by?.startsWith("key:")) return "Made by another key";
  return null;
}

function expiry(time: string | null | undefined, now: number) {
  if (!time) return "Never expires";
  const at = Date.parse(time);
  return at <= now ? "Expired" : `Expires ${new Date(at).toLocaleDateString()}`;
}

const ACCESS_NAMES: Record<string, string> = {
  read: "Read only",
  write: "Read and write",
  admin: "Admin",
};

function Keys() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [making, setMaking] = useState(false);
  const now = useNow();

  const load = useCallback(
    () =>
      fetch(withBase("/api/keys"))
        .then((response) => (response.ok ? response.json() : []))
        .then(setKeys),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  function used(time?: string | null) {
    if (!time) return "Never used";
    const since = ago(Date.parse(time), now);
    return since === "now" ? "Used just now" : `Used ${since} ago`;
  }

  return (
    <Section
      id="keys"
      title="API keys"
      description="Agents, the SDK, the MCP server and the CLI sign in with a key."
      action={
        <Button leadingIcon={Plus} onClick={() => setMaking(true)}>
          New key
        </Button>
      }
    >
      {keys?.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No keys yet.</p>
      )}
      {keys?.map((key) => (
        <Row key={key.id}>
          <Lines
            title={
              <>
                <span className="font-mono text-[13px]">{key.name}</span>
                <Tag>{ACCESS_NAMES[key.role] ?? key.role}</Tag>
              </>
            }
            detail={
              <>
                {key.namespaces === "*" ? (
                  "All filesystems"
                ) : (
                  <span className="font-mono">{key.namespaces}</span>
                )}
                {[maker(key), expiry(key.expires, now), used(key.last_used)]
                  .filter(Boolean)
                  .map((part) => ` · ${part}`)
                  .join("")}
              </>
            }
          />
          <Remove
            label="Revoke key"
            onClick={() =>
              act(() => fetch(withBase(`/api/keys?id=${key.id}`), { method: "DELETE" })).then(load)
            }
          />
        </Row>
      ))}
      <NewKey open={making} onOpenChange={setMaking} onMade={load} />
    </Section>
  );
}

type Access = "read" | "write" | "admin";
const ACCESS: { value: Access; label: string }[] = [
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
  { value: "admin", label: "Admin" },
];

function NewKey({
  open,
  onOpenChange,
  onMade,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMade: () => void;
}) {
  const [role, setRole] = useState<Access>("write");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { name: form.get("name"), role, namespaces: form.get("namespaces") || "*" };
    setBusy(true);
    await act(async () => {
      const response = await fetch(withBase("/api/keys"), {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not make the key");
      setSecret(data.key);
      onMade();
    });
    setBusy(false);
  }

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) setSecret("");
  }

  if (secret)
    return (
      <FormDialog
        open={open}
        onOpenChange={close}
        title="Your new key"
        description="Copy it now. It is not shown again."
      >
        <div className="grid gap-4">
          <code className="rounded-lg border bg-muted/40 px-3 py-2.5 font-mono text-sm break-all select-all">
            {secret}
          </code>
          <DialogFooter>
            <Button size="default" leadingIcon={Copy} onClick={() => copy(secret, "Key")}>
              Copy
            </Button>
            <Button size="default" variant="primary" onClick={() => close(false)}>
              Done
            </Button>
          </DialogFooter>
        </div>
      </FormDialog>
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={close}
      title="New API key"
      description="For an agent, the SDK, the MCP server or the CLI."
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Name">
          <Input name="name" placeholder="ci-agents" required autoFocus />
        </Field>
        <Field label="Filesystems">
          <Input
            name="namespaces"
            placeholder="All, or a pattern like prod/*"
            className="font-mono"
          />
        </Field>
        <Field label="Access">
          <Choice value={role} options={ACCESS} onChange={setRole} />
        </Field>
        <Actions submit="Make key" busy={busy} />
      </form>
    </FormDialog>
  );
}

function Security() {
  const { data: session, refetch } = authClient.useSession();
  const { data: passkeys, refetch: refetchPasskeys } = authClient.useListPasskeys();
  const [changing, setChanging] = useState(false);
  const twoFactor = Boolean(session?.user.twoFactorEnabled);

  return (
    <Section
      id="security"
      title="Security"
      description="How you sign in. These apply to your account only."
    >
      <Row>
        <Glyph icon={Fingerprint} />
        <Lines
          title="Passkeys"
          detail={
            passkeys?.length
              ? `${passkeys.length} added. Sign in with Touch ID, Face ID or a security key.`
              : "Sign in with Touch ID, Face ID or a security key."
          }
        />
        <Button
          leadingIcon={Plus}
          onClick={() => act(() => authClient.passkey.addPasskey()).then(() => refetchPasskeys())}
        >
          Add passkey
        </Button>
      </Row>
      {passkeys?.map((passkey) => (
        <Row key={passkey.id}>
          <span className="w-9 shrink-0" />
          <Lines
            title={<span className="font-normal">{passkey.name || "Passkey"}</span>}
            detail={`Added ${new Date(passkey.createdAt).toLocaleDateString()}`}
          />
          <Remove
            label="Remove passkey"
            onClick={() =>
              act(() => authClient.passkey.deletePasskey({ id: passkey.id })).then(() =>
                refetchPasskeys(),
              )
            }
          />
        </Row>
      ))}
      <Row>
        <Glyph icon={ShieldCheck} />
        <Lines
          title={
            <>
              Two-factor sign-in
              <span
                className={cx(
                  "size-1.5 rounded-full",
                  twoFactor ? "bg-green" : "bg-muted-foreground/40",
                )}
              />
              <span className="text-[13px] font-normal text-muted-foreground">
                {twoFactor ? "On" : "Off"}
              </span>
            </>
          }
          detail="Ask for a code from your authenticator app."
        />
        <Button onClick={() => setChanging(true)}>{twoFactor ? "Turn off" : "Turn on"}</Button>
      </Row>
      <TwoFactor open={changing} onOpenChange={setChanging} on={twoFactor} onDone={refetch} />
    </Section>
  );
}

function TwoFactor({
  open,
  onOpenChange,
  on,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  on: boolean;
  onDone: () => void;
}) {
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    setBusy(true);
    await act(async () => {
      const result = on
        ? await authClient.twoFactor.disable({ password })
        : await authClient.twoFactor.enable({ password });
      if (result.data && "totpURI" in result.data) setSetup(result.data);
      else if (!result.error) onOpenChange(false);
      onDone();
      return result;
    });
    setBusy(false);
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code"));
    setBusy(true);
    const ok = await act(() => authClient.twoFactor.verifyTotp({ code }));
    setBusy(false);
    if (ok) close(false);
    onDone();
  }

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) setSetup(null);
  }

  if (setup) {
    const secret = new URL(setup.totpURI).searchParams.get("secret") ?? "";
    return (
      <FormDialog
        open={open}
        onOpenChange={close}
        title="Add Skywake to your authenticator"
        description="Enter this key in the app, then type the code it shows."
      >
        <form onSubmit={verify} className="grid gap-4">
          <button
            type="button"
            title="Copy"
            onClick={() => copy(secret, "Key")}
            className="rounded-lg border bg-muted/40 px-3 py-2.5 text-left font-mono text-sm break-all hover:bg-hover"
          >
            {secret}
          </button>
          <Field label="Backup codes, each good once">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border px-3 py-2.5 font-mono text-sm">
              {setup.backupCodes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>
          </Field>
          <Field label="Code from the app">
            <Input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              required
              autoFocus
              className="font-mono"
            />
          </Field>
          <Actions submit="Confirm" busy={busy} />
        </form>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={close}
      title={on ? "Turn off two-factor sign-in" : "Turn on two-factor sign-in"}
      description="Confirm it is you with your password."
    >
      <form onSubmit={confirmPassword} className="grid gap-4">
        <Field label="Password">
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
          />
        </Field>
        <Actions submit={on ? "Turn off" : "Continue"} busy={busy} />
      </form>
    </FormDialog>
  );
}
