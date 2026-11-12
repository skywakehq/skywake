"use client";

import { Check, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  loadStripe,
  type Appearance,
  type StripeCheckoutElementsSdk,
  type StripeCheckoutLoadActionsSuccess,
  type StripeCheckoutSession,
} from "@stripe/stripe-js";
import { Dialog, DialogContent, DialogTitle } from "@skywake/ui/components/dialog";
import { authClient } from "@/features/auth/auth-client";
import { Button } from "@/components/kit";
import { CountryPicker, guessCountry } from "./country";

export type CheckoutPlan = {
  plan: "launch" | "scale";
  name: string;
  minimumCents: number;
  features: string[];
  clientSecret: string;
  publishableKey: string;
};

export type Rate = { name: string; price: string };

const money = (cents: number) =>
  (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 ? 2 : 0,
  });

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** A radius token in px: Stripe needs a plain length, and the token holds
 * a calc(), so it is measured on a probe element. */
function radius(token: string) {
  const probe = document.createElement("div");
  probe.style.borderRadius = `var(${token})`;
  document.body.appendChild(probe);
  const px = getComputedStyle(probe).borderTopLeftRadius;
  probe.remove();
  return px;
}

function appearance(): Appearance {
  const dark = document.documentElement.classList.contains("dark");
  return {
    theme: dark ? "night" : "stripe",
    variables: {
      colorPrimary: cssVar("--foreground"),
      colorBackground: cssVar("--background"),
      colorText: cssVar("--foreground"),
      colorTextSecondary: cssVar("--muted-foreground"),
      colorDanger: "#e5484d",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontSizeBase: "14px",
      borderRadius: radius("--radius-md"),
      spacingUnit: "4px",
    },
    rules: {
      ".Input": { boxShadow: "none", border: `1px solid ${cssVar("--border")}` },
      ".Input:focus": { boxShadow: "none", borderColor: cssVar("--foreground") },
      ".Tab": { boxShadow: "none", border: `1px solid ${cssVar("--border")}` },
      ".Label": { fontWeight: "400" },
    },
  };
}

/** The console's own checkout: the order on the left, Stripe's card form on the right. */
export function Checkout({
  choice,
  rates,
  onClose,
  onPaid,
}: {
  choice: CheckoutPlan | null;
  rates: Rate[];
  onClose: () => void;
  onPaid: () => void;
}) {
  return (
    <Dialog open={choice !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[880px]"
        showCloseButton={false}
      >
        {choice && <Order choice={choice} rates={rates} onClose={onClose} onPaid={onPaid} />}
      </DialogContent>
    </Dialog>
  );
}

function Order({
  choice,
  rates,
  onClose,
  onPaid,
}: {
  choice: CheckoutPlan;
  rates: Rate[];
  onClose: () => void;
  onPaid: () => void;
}) {
  const { data: signedIn } = authClient.useSession();
  const email = signedIn?.user.email ?? null;
  const mount = useRef<HTMLDivElement>(null);
  const [actions, setActions] = useState<StripeCheckoutLoadActionsSuccess | null>(null);
  const [session, setSession] = useState<StripeCheckoutSession | null>(null);
  const [ready, setReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState(guessCountry);

  useEffect(() => {
    let sdk: StripeCheckoutElementsSdk | null = null;
    let gone = false;
    (async () => {
      const stripe = await loadStripe(choice.publishableKey);
      if (!stripe || gone) return;
      sdk = stripe.initCheckoutElementsSdk({
        clientSecret: choice.clientSecret,
        elementsOptions: {
          appearance: appearance(),
          fonts: [{ cssSrc: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500" }],
        },
      });
      sdk.on("change", setSession);
      const element = sdk.createPaymentElement({
        layout: "tabs",
        fields: { billingDetails: { address: { country: "never" } } },
      });
      element.on("ready", () => setReady(true));
      if (mount.current) element.mount(mount.current);
      const loaded = await sdk.loadActions();
      if (gone) return;
      if (loaded.type === "error") throw new Error(loaded.error.message);
      setActions(loaded.actions);
      setSession(loaded.actions.getSession());
    })().catch((failure: unknown) => {
      if (!gone) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => {
      gone = true;
      sdk?.getPaymentElement()?.destroy();
    };
  }, [choice.clientSecret, choice.publishableKey]);

  useEffect(() => {
    if (actions && session && !session.email && email) void actions.updateEmail(email);
  }, [actions, session, email]);

  const due = session?.total.total.amount ?? money(choice.minimumCents);

  const pay = async () => {
    if (!actions) return;
    setPaying(true);
    setError(null);
    const result = await actions.confirm({
      redirect: "if_required",
      billingAddress: { address: { country } },
    });
    setPaying(false);
    if (result.type === "error") setError(result.error.message);
    else onPaid();
  };

  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col border-b border-border/60 bg-muted/40 p-7 md:border-r md:border-b-0">
        <p className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
          Skywake {choice.name}
        </p>
        <DialogTitle className="mt-3 flex items-baseline gap-2 font-normal">
          <span className="text-[34px] leading-none font-medium tracking-[-0.03em] tabular-nums">
            {money(choice.minimumCents)}
          </span>
          <span className="text-sm text-muted-foreground">minimum a month</span>
        </DialogTitle>
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          The minimum is credited back against your usage. You pay more only in a month when usage
          costs more than {money(choice.minimumCents)}.
        </p>

        {choice.features.length > 0 && (
          <ul className="mt-6 flex flex-col gap-2">
            {choice.features.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-[13px]">
                <Check className="size-3.5 text-muted-foreground" aria-hidden />
                {feature}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-7">
          <p className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
            Usage rates
          </p>
          <dl className="mt-3 divide-y divide-border/60 border-y border-border/60">
            {rates.map((rate) => (
              <div key={rate.name} className="flex justify-between gap-4 py-2 text-[13px]">
                <dt className="text-muted-foreground">{rate.name}</dt>
                <dd className="tabular-nums">{rate.price}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-auto flex items-baseline justify-between pt-8">
          <span className="text-sm">Due today</span>
          <span className="text-xl font-medium tabular-nums">{due}</span>
        </div>
      </section>

      <section className="flex flex-col p-7">
        <p className="text-sm font-medium">Payment</p>
        <div className="mt-4 flex items-center justify-between border border-border px-3 py-2.5 text-[13px]">
          <span className="text-muted-foreground">Billed to</span>
          <span className="truncate">{session?.email ?? email ?? "…"}</span>
        </div>
        <label className="mt-5 mb-1.5 block text-[13px] text-muted-foreground">Country</label>
        <CountryPicker value={country} onChange={setCountry} />
        <div className="mt-5 min-h-[180px]">
          {!ready && !error && (
            <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
              Loading the card form…
            </div>
          )}
          <div ref={mount} />
        </div>
        {error && <p className="mt-4 text-[13px] text-destructive">{error}</p>}
        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant="primary"
            size="default"
            disabled={!ready || !actions || paying || session?.canConfirm === false}
            onClick={pay}
          >
            {paying ? "Subscribing…" : `Subscribe for ${due}`}
          </Button>
          <Button size="default" type="button" onClick={onClose} disabled={paying}>
            Cancel
          </Button>
        </div>
        <p className="mt-5 flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          Payments by Stripe. Cancel any time in Settings.
        </p>
      </section>
    </div>
  );
}
