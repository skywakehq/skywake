"use client";

import { Terminal } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button, Choice, Field, Input, Page } from "@/components/kit";
import { navigate } from "@/components/shell/router";
import { useEnvironments } from "@/features/environments/use-environments";
import { Select } from "@/components/fields";
import { act } from "@/features/settings/parts";
import { useEnvironment } from "@/hooks/use-ns";
import { withBase } from "@/lib/zone";

type Access = "read" | "write" | "admin";

type Login = {
  code: string;
  device: string;
  expires: string;
  role: Access;
  every_environment: boolean;
};

type State =
  | { step: "loading" }
  | { step: "missing" }
  | { step: "asking"; login: Login }
  | { step: "allowed"; login: Login; environment: string | null };

const ACCESS: { value: Access; label: string }[] = [
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
  { value: "admin", label: "Admin" },
];

const EVERY = "";
const TITLE = "Sign in the CLI";
const EYEBROW = "Command line";

const loginPath = (code: string) => withBase(`/api/logins/${encodeURIComponent(code)}`);

export function CliLogin({ code }: { code: string }) {
  if (!code) return <EnterCode />;
  return <Approve code={code} />;
}

function EnterCode() {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    if (code) navigate(`/cli/${encodeURIComponent(code.toUpperCase())}`);
  }

  return (
    <Page narrow eyebrow={EYEBROW} title={TITLE}>
      <form onSubmit={submit} className="grid max-w-sm gap-4">
        <Field label="The code your terminal shows">
          <Input name="code" placeholder="ABCD-2345" autoFocus required />
        </Field>
        <Button size="default" variant="primary" className="justify-self-start">
          Continue
        </Button>
      </form>
    </Page>
  );
}

function Notice({ title, description }: { title: string; description?: string }) {
  return (
    <Page narrow eyebrow={EYEBROW} title={title} description={description}>
      {null}
    </Page>
  );
}

function Approve({ code }: { code: string }) {
  const [state, setState] = useState<State>({ step: "loading" });

  useEffect(() => {
    let live = true;
    fetch(loginPath(code))
      .then(async (response) => (response.ok ? ((await response.json()) as Login) : null))
      .catch(() => null)
      .then((login) => {
        if (live) setState(login ? { step: "asking", login } : { step: "missing" });
      });
    return () => {
      live = false;
    };
  }, [code]);

  if (state.step === "loading") return <Notice title={TITLE} />;
  if (state.step === "missing")
    return (
      <Notice
        title="This code has expired"
        description={`No sign-in waits for ${code}. Run skywake login again for a new code.`}
      />
    );
  if (state.step === "allowed")
    return (
      <Notice
        title="The CLI is signed in"
        description={`${state.login.device} now has a key for ${
          state.environment ?? "every environment"
        }. You can go back to your terminal.`}
      />
    );
  return (
    <Asking
      login={state.login}
      onAllowed={(environment) => setState({ step: "allowed", login: state.login, environment })}
    />
  );
}

function Asking({
  login,
  onAllowed,
}: {
  login: Login;
  onAllowed: (environment: string | null) => void;
}) {
  const { envs } = useEnvironments();
  const current = useEnvironment();
  const roles = ACCESS.slice(0, ACCESS.findIndex((a) => a.value === login.role) + 1);
  const [role, setRole] = useState<Access>(
    roles.some((r) => r.value === "write") ? "write" : "read",
  );
  const [busy, setBusy] = useState(false);
  const fallback = current ?? envs[0]?.name ?? (login.every_environment ? EVERY : "default");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = String(new FormData(event.currentTarget).get("environment") ?? EVERY);
    const environment = chosen === EVERY ? null : chosen;
    setBusy(true);
    const ok = await act(async () => {
      const response = await fetch(loginPath(login.code), {
        method: "POST",
        body: JSON.stringify({ environment, role }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Could not allow the sign-in");
    });
    setBusy(false);
    if (ok) onAllowed(environment);
  }

  return (
    <Page
      narrow
      eyebrow={EYEBROW}
      title={TITLE}
      description={`The CLI on ${login.device} asks for a key. Allow it only if your terminal shows this code.`}
    >
      <form onSubmit={submit} className="grid max-w-md gap-6">
        <div className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3">
          <Terminal className="size-4 text-muted-foreground" />
          <code className="font-mono text-2xl tracking-[0.2em]">{login.code}</code>
        </div>
        <Field label="Environment">
          <Select name="environment" defaultValue={fallback} key={fallback}>
            {login.every_environment && <option value={EVERY}>Every environment</option>}
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
          <Button size="default" type="button" onClick={() => navigate("/")}>
            Cancel
          </Button>
        </div>
      </form>
    </Page>
  );
}
