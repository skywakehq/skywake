"use client";

import { Globe, Network, Plus } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Button, Field, Input } from "@/components/kit";
import { act, Actions, FormDialog, Glyph, Lines, Remove, Row, Section } from "./settings";
import { withBase } from "@/lib/zone";

async function save(cidrs: string[]) {
  const response = await fetch(withBase("/api/ip-allowlist"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cidrs }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not save the list");
  return data.cidrs as string[];
}

/** Where keys and people may call the API from. Only admins see this part. */
export function IpAllowlist() {
  const [cidrs, setCidrs] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    () =>
      fetch(withBase("/api/ip-allowlist"))
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => setCidrs(data?.cidrs ?? null)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const change = (next: string[]) => act(async () => setCidrs(await save(next)));

  if (cidrs === null) return null;
  return (
    <Section
      id="ip-allowlist"
      title="IP allowlist"
      description="Keys and people can call only from these addresses. Empty means anywhere."
      action={
        <Button leadingIcon={Plus} onClick={() => setAdding(true)}>
          Add range
        </Button>
      }
    >
      {cidrs.length === 0 && (
        <Row>
          <Glyph icon={Globe} />
          <Lines title="Anywhere" detail="Add a range to allow only your network." />
        </Row>
      )}
      {cidrs.map((cidr) => (
        <Row key={cidr}>
          <Glyph icon={Network} />
          <Lines title={<span className="font-mono text-[13px]">{cidr}</span>} />
          <Remove
            label="Remove range"
            onClick={() => change(cidrs.filter((other) => other !== cidr))}
          />
        </Row>
      ))}
      <AddRange
        open={adding}
        onOpenChange={setAdding}
        onAdd={async (cidr) => (await change([...cidrs, cidr])) && setAdding(false)}
      />
    </Section>
  );
}

function AddRange({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (cidr: string) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    await onAdd(String(new FormData(event.currentTarget).get("cidr")).trim());
    setBusy(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a range"
      description="An address or a CIDR range, IPv4 or IPv6. Your own address must stay in the list."
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Range">
          <Input
            name="cidr"
            placeholder="203.0.113.0/24"
            required
            autoFocus
            className="font-mono"
          />
        </Field>
        <Actions submit="Add" busy={busy} />
      </form>
    </FormDialog>
  );
}
