"use client";

import { Check, Copy, Download } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { encode } from "uqr";
import { Button, Field, Input } from "@/components/kit";
import { authClient } from "@/features/auth/auth-client";
import { act, copy } from "./parts";

type Setup = { totpURI: string; backupCodes: string[] };
type Step = "password" | "scan" | "codes";

/** The QR code an authenticator app scans, drawn as one path so it stays sharp. */
function Qr({ value }: { value: string }) {
  const { size, path } = useMemo(() => {
    const { data } = encode(value, { border: 0, ecc: "M" });
    let path = "";
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) path += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size: data.length, path };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className="size-full">
      <path d={path} fill="#111" />
    </svg>
  );
}

/**
 * Turning two-factor sign-in on or off. On: confirm the password, scan the
 * code, type what the app shows, then keep the backup codes.
 */
export function TwoFactorFlow({ on, onDone }: { on: boolean; onDone: () => void }) {
  const [step, setStep] = useState<Step>("password");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function confirmPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    setBusy(true);
    await act(async () => {
      const result = on
        ? await authClient.twoFactor.disable({ password })
        : await authClient.twoFactor.enable({ password });
      if (result.data && "totpURI" in result.data) {
        setSetup(result.data);
        setStep("scan");
      } else if (!result.error) onDone();
      return result;
    });
    setBusy(false);
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code")).replace(/\s/g, "");
    setBusy(true);
    if (await act(() => authClient.twoFactor.verifyTotp({ code }))) setStep("codes");
    setBusy(false);
  }

  if (step === "password")
    return (
      <form onSubmit={confirmPassword} className="grid gap-5">
        <Heading
          title={on ? "Turn off two-factor sign-in" : "Turn on two-factor sign-in"}
          lead="Confirm it is you with your password."
        />
        <Field label="Password">
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
          />
        </Field>
        <Footer busy={busy} submit={on ? "Turn off" : "Continue"} onCancel={onDone} />
      </form>
    );

  if (step === "scan" && setup) {
    const secret = new URL(setup.totpURI).searchParams.get("secret") ?? "";
    return (
      <form onSubmit={verify} className="grid gap-6">
        <Heading
          title="Scan with your authenticator"
          lead="1Password, Google Authenticator, Authy or any app that makes six-digit codes."
        />
        <div className="flex flex-wrap items-center gap-6">
          <div className="size-44 shrink-0 rounded-2xl bg-white p-3.5">
            <Qr value={setup.totpURI} />
          </div>
          <div className="grid min-w-0 flex-1 gap-2 text-sm">
            <span className="text-muted-foreground">Can&apos;t scan? Enter this key.</span>
            <button
              type="button"
              onClick={() => copy(secret, "Key")}
              className="flex items-center gap-2 rounded-xl bg-tint px-3 py-2.5 text-left font-mono text-[12.5px] break-all transition-colors hover:bg-active"
            >
              <span className="min-w-0 flex-1">{secret.match(/.{1,4}/g)?.join(" ")}</span>
              <Copy className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </div>
        </div>
        <Field label="Code from the app">
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123 456"
            required
            autoFocus
            className="h-11 font-mono text-base tracking-[0.3em]"
          />
        </Field>
        <Footer busy={busy} submit="Turn on" onCancel={onDone} />
      </form>
    );
  }

  const codes = setup?.backupCodes ?? [];
  return (
    <div className="grid gap-6">
      <Heading
        title="Two-factor sign-in is on"
        lead="Keep these backup codes somewhere safe. Each signs you in once if you lose your phone."
      />
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-2xl bg-tint px-5 py-4 font-mono text-[13px] tabular-nums">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="default"
          leadingIcon={copied ? Check : Copy}
          onClick={() => (copy(codes.join("\n"), "Backup codes"), setCopied(true))}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="default" leadingIcon={Download} onClick={() => save(codes)}>
          Download
        </Button>
        <Button size="default" variant="primary" className="ml-auto" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function save(codes: string[]) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([`${codes.join("\n")}\n`], { type: "text/plain" }));
  link.download = "skywake-backup-codes.txt";
  link.click();
  URL.revokeObjectURL(link.href);
}

function Heading({ title, lead }: { title: string; lead: string }) {
  return (
    <div>
      <h3 className="text-[17px] font-medium tracking-[-0.015em]">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{lead}</p>
    </div>
  );
}

function Footer({
  busy,
  submit,
  onCancel,
}: {
  busy: boolean;
  submit: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button size="default" type="button" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="default" variant="primary" disabled={busy}>
        {submit}
      </Button>
    </div>
  );
}
