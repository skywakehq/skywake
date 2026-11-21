"use client";

import {
  Check,
  Fingerprint,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Plus,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@skywake/ui/components/dialog";
import { Avatar, Button, cx, Field, Input } from "@/components/kit";
import { useHash } from "@/components/shell/router";
import { authClient } from "@/features/auth/auth-client";
import { withBase } from "@/lib/zone";
import { act, Glyph, Lines, Panel, Remove, Row, Tag } from "./parts";
import { TwoFactorFlow } from "./two-factor";

const HASH = "account";

type Tab = "profile" | "appearance" | "security";
const TABS: { tab: Tab; label: string; icon: typeof UserRound }[] = [
  { tab: "profile", label: "Profile", icon: UserRound },
  { tab: "appearance", label: "Appearance", icon: Palette },
  { tab: "security", label: "Sign-in & security", icon: ShieldCheck },
];

/** Opens your account settings over whatever page is showing. */
export function openAccount() {
  location.hash = HASH;
}

function closeAccount() {
  history.replaceState(null, "", location.pathname + location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Your own settings, not the organization's: name, theme, password, passkeys, two-factor. */
export function AccountDialog() {
  const open = useHash() === HASH;
  const [tab, setTab] = useState<Tab>("profile");
  const { data: session } = authClient.useSession();
  const user = session?.user;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeAccount()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[780px]">
        <DialogTitle className="sr-only">Your account</DialogTitle>
        <div className="grid h-[min(580px,85dvh)] sm:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-5 bg-(--panel) p-3 max-sm:hidden">
            <div className="flex items-center gap-3 px-2 pt-2">
              <Avatar name={user?.name ?? ""} className="size-9" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user?.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </div>
            <nav className="grid gap-0.5">
              {TABS.map(({ tab: each, label, icon: Icon }) => (
                <button
                  key={each}
                  type="button"
                  onClick={() => setTab(each)}
                  className={cx(
                    "flex h-9 items-center gap-2.5 rounded-xl px-3 text-left text-sm transition-colors",
                    each === tab
                      ? "bg-active font-medium text-foreground"
                      : "text-muted-foreground hover:bg-hover hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </nav>
            <button
              type="button"
              onClick={async () => {
                await authClient.signOut();
                location.assign(withBase("/sign-in"));
              }}
              className="mt-auto flex h-9 items-center gap-2.5 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </aside>
          <div className="min-w-0 overflow-y-auto p-7 max-sm:p-5">
            <nav className="mb-6 flex gap-1 overflow-x-auto sm:hidden">
              {TABS.map(({ tab: each, label }) => (
                <button
                  key={each}
                  type="button"
                  onClick={() => setTab(each)}
                  className={cx(
                    "h-8 shrink-0 rounded-lg px-3 text-sm",
                    each === tab ? "bg-active text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>
            {tab === "profile" && <Profile />}
            {tab === "appearance" && <Appearance />}
            {tab === "security" && <Security />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Heading({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-[20px] leading-7 font-medium tracking-[-0.025em]">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{lead}</p>
    </div>
  );
}

function Profile() {
  const { data: session, refetch } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const user = session?.user;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    if (!name || name === user?.name) return;
    setBusy(true);
    if (await act(() => authClient.updateUser({ name }))) {
      toast.success("Saved");
      refetch();
    }
    setBusy(false);
  }

  return (
    <>
      <Heading title="Profile" lead="How you show up to the people you work with." />
      <div className="mb-7 flex items-center gap-4">
        <Avatar name={user?.name ?? ""} className="size-16" />
        <div className="min-w-0">
          <p className="truncate text-base font-medium">{user?.name}</p>
          <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </div>
      <form onSubmit={save} key={user?.name} className="grid gap-4">
        <Field label="Name">
          <Input name="name" defaultValue={user?.name} required className="h-10 rounded-xl" />
        </Field>
        <Field label="Email">
          <Input value={user?.email ?? ""} readOnly disabled className="h-10 rounded-xl" />
        </Field>
        <div className="flex justify-end">
          <Button size="default" variant="primary" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </>
  );
}

const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

function Preview({ dark }: { dark: boolean }) {
  return (
    <span className={cx("flex h-full w-full gap-1.5 p-2", dark ? "bg-[#161615]" : "bg-[#f6f5f1]")}>
      <span className={cx("w-1/4 rounded-md", dark ? "bg-[#222220]" : "bg-[#ecebe5]")} />
      <span
        className={cx(
          "grid flex-1 content-start gap-1.5 rounded-md p-2",
          dark ? "bg-[#1d1d1c]" : "bg-white",
        )}
      >
        <span className={cx("h-1.5 w-1/2 rounded-full", dark ? "bg-[#4a4a47]" : "bg-[#d6d4cc]")} />
        <span className={cx("h-1.5 w-3/4 rounded-full", dark ? "bg-[#333331]" : "bg-[#e8e6df]")} />
        <span className={cx("h-1.5 w-2/3 rounded-full", dark ? "bg-[#333331]" : "bg-[#e8e6df]")} />
      </span>
    </span>
  );
}

function Appearance() {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <Heading title="Appearance" lead="How the console looks on this device." />
      <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
        {THEMES.map(({ value, label, icon: Icon }) => {
          const picked = (theme ?? "system") === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={picked}
              className="group grid gap-2.5 text-left"
            >
              <span
                className={cx(
                  "relative flex h-24 overflow-hidden rounded-2xl ring-2 ring-offset-2 ring-offset-background transition-shadow",
                  picked ? "ring-signal" : "ring-transparent group-hover:ring-foreground/10",
                )}
              >
                <Preview dark={value === "dark"} />
                {value === "system" && (
                  <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
                    <Preview dark />
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2 px-1 text-sm">
                <Icon className="size-3.5 text-muted-foreground" />
                {label}
                {picked && <Check className="ml-auto size-3.5 text-signal" />}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Security() {
  const { data: session, refetch } = authClient.useSession();
  const { data: passkeys, refetch: refetchPasskeys } = authClient.useListPasskeys();
  const [flow, setFlow] = useState<"two-factor" | "password" | null>(null);
  const twoFactor = Boolean(session?.user.twoFactorEnabled);

  if (flow === "two-factor")
    return <TwoFactorFlow on={twoFactor} onDone={() => (setFlow(null), refetch())} />;
  if (flow === "password") return <ChangePassword onDone={() => setFlow(null)} />;

  return (
    <>
      <Heading title="Sign-in & security" lead="How you sign in. This is your account only." />
      <div className="grid gap-6">
        <Group title="Two-factor sign-in">
          <Row>
            <Glyph icon={ShieldCheck} tone={twoFactor ? "green" : undefined} />
            <Lines
              title={
                <>
                  Authenticator app
                  {twoFactor && <Tag tone="green">On</Tag>}
                </>
              }
              detail="Ask for a six-digit code when you sign in."
            />
            <Button
              variant={twoFactor ? undefined : "primary"}
              onClick={() => setFlow("two-factor")}
            >
              {twoFactor ? "Turn off" : "Set up"}
            </Button>
          </Row>
        </Group>
        <Group
          title="Passkeys"
          action={
            <Button
              variant="plain"
              leadingIcon={Plus}
              onClick={() =>
                act(() => authClient.passkey.addPasskey()).then(() => refetchPasskeys())
              }
            >
              Add
            </Button>
          }
        >
          {!passkeys?.length && (
            <Row>
              <Glyph icon={Fingerprint} />
              <Lines
                title="No passkeys"
                detail="Sign in with Touch ID, Face ID or a security key."
              />
            </Row>
          )}
          {passkeys?.map((passkey) => (
            <Row key={passkey.id}>
              <Glyph icon={Fingerprint} tone="signal" />
              <Lines
                title={passkey.name || "Passkey"}
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
        </Group>
        <Group title="Password">
          <Row>
            <Glyph icon={KeyRound} />
            <Lines title="Password" detail="Change it any time. Other devices stay signed in." />
            <Button onClick={() => setFlow("password")}>Change</Button>
          </Row>
        </Group>
      </div>
    </>
  );
}

function Group({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex h-8 items-center justify-between">
        <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>
        {action}
      </div>
      <Panel>{children}</Panel>
    </section>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const ok = await act(() =>
      authClient.changePassword({
        currentPassword: String(form.get("current")),
        newPassword: String(form.get("next")),
      }),
    );
    setBusy(false);
    if (ok) {
      toast.success("Password changed");
      onDone();
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <Heading title="Change your password" lead="At least 8 characters." />
      <Field label="Current password">
        <Input name="current" type="password" autoComplete="current-password" required autoFocus />
      </Field>
      <Field label="New password">
        <Input name="next" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <div className="flex justify-end gap-2">
        <Button size="default" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button size="default" variant="primary" disabled={busy}>
          Change password
        </Button>
      </div>
    </form>
  );
}
