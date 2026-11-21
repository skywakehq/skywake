"use client";

import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { DialogFooter } from "@skywake/ui/components/dialog";
import { Button, Choice, Field, Input, ago, useNow } from "@/components/kit";
import { Select } from "@/components/fields";
import { useEnvironments } from "@/features/environments/use-environments";
import { useEnvironment } from "@/hooks/use-ns";
import { withBase } from "@/lib/zone";
import {
  act,
  Actions,
  copy,
  FormDialog,
  Glyph,
  Lines,
  Nothing,
  PageHeader,
  Panel,
  Remove,
  Row,
  Tag,
} from "./parts";

type Key = {
  id: string;
  name: string;
  role: string;
  environment: string | null;
  only: string[];
  last_used?: string | null;
  expires?: string | null;
  created_by?: string | null;
  created_by_email?: string | null;
};

const ACCESS_NAMES: Record<string, string> = {
  read: "Read only",
  write: "Read and write",
  admin: "Admin",
};

function reach(key: Key) {
  const where = key.environment ? `Only ${key.environment}` : "Every environment";
  const names = key.only.filter((name) => name !== "*");
  return names.length ? `${where}: ${names.join(", ")}` : where;
}

function maker(key: Key) {
  if (key.created_by_email) return `Made by ${key.created_by_email}`;
  if (key.created_by?.startsWith("key:")) return "Made by another key";
  return null;
}

function expiry(time: string | null | undefined, now: number) {
  if (!time) return null;
  const at = Date.parse(time);
  return at <= now ? "Expired" : `Expires ${new Date(at).toLocaleDateString()}`;
}

/** The keys agents, the SDK, the MCP server and the CLI sign in with. */
export function Keys() {
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
    <>
      <PageHeader
        title="API keys"
        description="Agents, the SDK, the MCP server and the CLI sign in with a key."
        action={
          <Button variant="primary" leadingIcon={Plus} onClick={() => setMaking(true)}>
            New key
          </Button>
        }
      />
      <Panel>
        {keys?.length === 0 && <Nothing>No keys yet. Make one for each agent.</Nothing>}
        {keys?.map((key) => (
          <Row key={key.id}>
            <Glyph icon={KeyRound} tone={key.role === "admin" ? "signal" : undefined} />
            <Lines
              title={
                <>
                  {key.name}
                  <Tag>{ACCESS_NAMES[key.role] ?? key.role}</Tag>
                </>
              }
              detail={[reach(key), maker(key), expiry(key.expires, now), used(key.last_used)]
                .filter(Boolean)
                .join(" · ")}
            />
            <Remove
              label="Revoke key"
              onClick={() =>
                act(() => fetch(withBase(`/api/keys?id=${key.id}`), { method: "DELETE" })).then(
                  load,
                )
              }
            />
          </Row>
        ))}
      </Panel>
      <NewKey open={making} onOpenChange={setMaking} onMade={load} />
    </>
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
  const { envs } = useEnvironments();
  const current = useEnvironment();
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const environment = String(form.get("environment") ?? "");
    const only = String(form.get("only") ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const body = {
      name: form.get("name"),
      role,
      environment: environment || null,
      ...(only.length && { only }),
    };
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
    if (!next) {
      setSecret("");
      setCopied(false);
    }
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
          <code className="rounded-xl bg-tint px-3.5 py-3 font-mono text-[13px] break-all select-all">
            {secret}
          </code>
          <DialogFooter>
            <Button
              size="default"
              leadingIcon={copied ? Check : Copy}
              onClick={() => (copy(secret, "Key"), setCopied(true))}
            >
              {copied ? "Copied" : "Copy"}
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
        <Field label="Environment">
          <Select name="environment" defaultValue={current ?? ""} key={current}>
            <option value="">Every environment</option>
            {envs.map((env) => (
              <option key={env.name} value={env.name}>
                {env.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Only these disks">
          <Input name="only" placeholder="All, or names like products, logs-*" />
        </Field>
        <Field label="Access">
          <Choice value={role} options={ACCESS} onChange={setRole} />
        </Field>
        <Actions submit="Make key" busy={busy} />
      </form>
    </FormDialog>
  );
}
