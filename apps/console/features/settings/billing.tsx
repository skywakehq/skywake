"use client";

import { AlertTriangle, ChevronDown, CreditCard, Gauge, ReceiptText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/features/auth/auth-client";
import { Button, cx } from "@/components/kit";
import { act, FormDialog, Glyph, Lines, Row, Section, Tag } from "./settings";
import { withBase } from "@/lib/zone";
import { Checkout, type CheckoutPlan } from "./checkout";

type Plan = "free" | "launch" | "scale" | "enterprise" | "unlimited";
type Paid = "launch" | "scale";

type Meter = {
  meter: string;
  name: string;
  quantity: number;
  unit: string;
  price: string;
  amount_cents: number;
  limit: number | null;
};

type Offer = { plan: Plan; name: string; minimum_cents: number | null; features: string[] };

type Billing = {
  enabled: boolean;
  plan: Plan;
  name: string;
  status: string | null;
  period_start: string | null;
  period_end: string | null;
  next_plan: Paid | null;
  cancel_at_period_end: boolean;
  past_due_since: string | null;
  minimum_cents: number | null;
  usage_cents: number;
  estimate_cents: number;
  meters: Meter[];
  stored: { gb: number; limit_gb: number | null };
  indexes: { count: number; limit: number | null };
  files: { gb: number; limit_gb: number | null };
  filesystems: { count: number; limit: number | null };
  plans: Offer[];
  customer: boolean;
};

type Summary = { month: string; status: "open" | "closed"; total_cents: number };
type Line = {
  index: string;
  item: string;
  quantity: number;
  unit_price: number;
  amount_cents: number;
};

const FEATURES: Record<string, string> = {
  pinning: "Pinned replicas",
  sso: "Single sign-on",
  audit_log: "Audit log",
  ip_allowlist: "IP allowlists",
  customer_keys: "Customer-managed keys",
};

const UNITS: Record<string, string> = {
  storage: "GB-months stored",
  writes: "GB written",
  queries: "TB scanned",
  embeddings: "texts embedded",
  reranks: "documents reranked",
  pinned: "GB-hours pinned",
};

const money = (cents: number) =>
  (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

const amount = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

async function send(path: string, method: string, body?: unknown) {
  const response = await fetch(withBase(`/api/billing${path}`), {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Billing is not available right now");
  return data;
}

const go = (path: string, body: unknown = {}) =>
  act(async () => {
    const { url } = await send(path, "POST", body);
    window.location.assign(url);
  });

/** The organization's plan and what it has used. Only admins see this part. */
export function Billing() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [buying, setBuying] = useState<CheckoutPlan | null>(null);

  const load = useCallback(
    () =>
      fetch(withBase("/api/billing"))
        .then((response) => (response.ok ? response.json() : null))
        .then(setBilling),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  if (!billing) return null;
  if (!billing.enabled) return <Invoices />;

  const paying = billing.plan === "launch" || billing.plan === "scale";
  const buy = (plan: Paid) =>
    act(async () => {
      const started = await send("/checkout", "POST", { plan });
      if (started.url) return window.location.assign(started.url);
      const offer = billing.plans.find((each) => each.plan === plan)!;
      setChoosing(false);
      setBuying({
        plan,
        name: offer.name,
        minimumCents: offer.minimum_cents ?? 0,
        features: offer.features.map((feature) => FEATURES[feature] ?? feature),
        clientSecret: started.client_secret,
        publishableKey: started.publishable_key,
      });
    });
  const paid = async () => {
    setBuying(null);
    toast.success("Subscribed. Setting up your plan…");
    for (let tries = 0; tries < 20; tries++) {
      const fresh = await fetch(withBase("/api/billing")).then((response) => response.json());
      if (fresh.plan !== billing.plan) return setBilling(fresh);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    load();
  };
  const change = (body: () => Promise<Billing>) =>
    act(async () => {
      setBilling(await body());
      setChoosing(false);
    });

  return (
    <>
      <Section
        id="billing"
        title="Billing"
        description={
          paying
            ? `This period, ${day(billing.period_start)} to ${day(billing.period_end)}.`
            : `This month's use of the Free plan. It resets on ${day(billing.period_end)}.`
        }
        action={
          <div className="flex gap-2">
            {billing.customer && <Button onClick={() => go("/portal")}>Manage billing</Button>}
            {billing.plan !== "enterprise" && (
              <Button variant="primary" onClick={() => setChoosing(true)}>
                {paying ? "Change plan" : "Upgrade"}
              </Button>
            )}
          </div>
        }
      >
        <PlanRow billing={billing} />
        {billing.past_due_since && (
          <Row>
            <Glyph icon={AlertTriangle} />
            <Lines
              title="A payment failed"
              detail="Update your card. Paid features stop 7 days after the first failed payment."
            />
            <Button onClick={() => go("/portal")}>Update card</Button>
          </Row>
        )}
        {!paying && (
          <Limit
            name="Index storage"
            used={billing.stored.gb}
            limit={billing.stored.limit_gb}
            unit="GB"
          />
        )}
        {!paying && (
          <Limit
            name="Indexes"
            used={billing.indexes.count}
            limit={billing.indexes.limit}
            unit=""
          />
        )}
        {!paying && (
          <Limit
            name="Files stored"
            used={billing.files.gb}
            limit={billing.files.limit_gb}
            unit="GB"
          />
        )}
        {!paying && (
          <Limit
            name="Filesystems"
            used={billing.filesystems.count}
            limit={billing.filesystems.limit}
            unit=""
          />
        )}
        {billing.meters.map((meter) =>
          paying || billing.plan === "enterprise" ? (
            <Row key={meter.meter}>
              <Glyph icon={Gauge} />
              <Lines
                title={meter.name}
                detail={`${amount(meter.quantity)} ${meter.unit} at ${meter.price}`}
              />
              <span className="tabular-nums">{money(meter.amount_cents)}</span>
            </Row>
          ) : meter.limit !== null ? (
            <Limit
              key={meter.meter}
              name={meter.name}
              used={meter.quantity}
              limit={meter.limit}
              unit={meter.unit}
            />
          ) : null,
        )}
      </Section>
      <Choose
        open={choosing}
        onOpenChange={setChoosing}
        billing={billing}
        onPick={(plan) =>
          paying ? change(() => send("/subscription", "PUT", { plan })) : buy(plan)
        }
        onCancel={() =>
          change(() =>
            billing.cancel_at_period_end
              ? send("/resume", "POST", {})
              : send("/subscription", "DELETE"),
          )
        }
      />
      <Checkout
        choice={buying}
        rates={billing.meters.map((meter) => ({ name: meter.name, price: meter.price }))}
        onClose={() => setBuying(null)}
        onPaid={paid}
      />
      <Invoices />
    </>
  );
}

function PlanRow({ billing }: { billing: Billing }) {
  const minimum = billing.minimum_cents;
  const detail =
    billing.plan === "free"
      ? "No card needed. Upgrade for more room and paid features."
      : billing.plan === "enterprise"
        ? "Custom terms."
        : `${money(minimum ?? 0)} a month minimum, counted toward usage. ${money(billing.usage_cents)} used so far.`;
  return (
    <Row>
      <Glyph icon={CreditCard} />
      <Lines
        title={
          <>
            {billing.name}
            {billing.cancel_at_period_end && <Tag>Ends {day(billing.period_end)}</Tag>}
            {billing.next_plan && (
              <Tag>
                Moves to {billing.next_plan === "scale" ? "Scale" : "Launch"} on{" "}
                {day(billing.period_end)}
              </Tag>
            )}
          </>
        }
        detail={detail}
      />
      {billing.plan !== "free" && (
        <span className="text-right">
          <span className="block tabular-nums">{money(billing.estimate_cents)}</span>
          <span className="block text-[12px] text-muted-foreground">so far</span>
        </span>
      )}
    </Row>
  );
}

function Limit({
  name,
  used,
  limit,
  unit,
}: {
  name: string;
  used: number;
  limit: number | null;
  unit: string;
}) {
  if (limit === null) return null;
  const share = Math.min(1, limit === 0 ? 1 : used / limit);
  return (
    <Row>
      <Glyph icon={Gauge} />
      <Lines
        title={
          <>
            {name}
            {share >= 1 ? (
              <Tag>Limit reached</Tag>
            ) : share >= 0.8 ? (
              <Tag>Almost at the limit</Tag>
            ) : null}
          </>
        }
        detail={
          <span className="rounded-full mt-1.5 block h-1 w-full max-w-64 bg-muted">
            <span
              className={cx("block h-full", share >= 1 ? "bg-destructive" : "bg-foreground")}
              style={{ width: `${share * 100}%` }}
            />
          </span>
        }
      />
      <span className="tabular-nums text-muted-foreground">
        {amount(used)} of {amount(limit)} {unit}
      </span>
    </Row>
  );
}

function Choose({
  open,
  onOpenChange,
  billing,
  onPick,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billing: Billing;
  onPick: (plan: Paid) => void;
  onCancel: () => void;
}) {
  const paying = billing.plan === "launch" || billing.plan === "scale";
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={paying ? "Change plan" : "Upgrade"}
      description="Usage is billed by the meter. Each plan's monthly minimum counts toward it."
    >
      <div className="-mx-6 divide-y divide-border/60 border-y border-border/60">
        {billing.plans
          .filter((offer) => offer.plan !== "free")
          .map((offer) => {
            const current = offer.plan === billing.plan && !billing.next_plan;
            return (
              <div key={offer.plan} className="flex items-center gap-3.5 px-6 py-3 text-sm">
                <Lines
                  title={
                    <>
                      {offer.name}
                      {current && <Tag>Current</Tag>}
                    </>
                  }
                  detail={
                    offer.plan === "enterprise"
                      ? "Custom terms and support. Contact us."
                      : `${money(offer.minimum_cents ?? 0)} a month minimum. ${
                          offer.features.map((feature) => FEATURES[feature]).join(", ") ||
                          "Usage only"
                        }.`
                  }
                />
                {offer.plan !== "enterprise" && !current && (
                  <Button variant="primary" onClick={() => onPick(offer.plan as Paid)}>
                    {paying ? "Switch" : "Choose"}
                  </Button>
                )}
              </div>
            );
          })}
      </div>
      {paying && (
        <p className="text-[13px] text-muted-foreground">
          A larger plan starts now, with the rest of this period charged. A smaller one starts when
          the period ends.{" "}
          <button type="button" className="underline" onClick={onCancel}>
            {billing.cancel_at_period_end ? "Keep the subscription" : "End the subscription"}
          </button>
        </p>
      )}
    </FormDialog>
  );
}

const invoicesApi = (org: string, path = "") =>
  withBase(`/api/skywake/orgs/${encodeURIComponent(org)}/invoices${path}`);

function Invoices() {
  const { data: org } = authClient.useActiveOrganization();
  const [invoices, setInvoices] = useState<Summary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    fetch(invoicesApi(org.id))
      .then((response) => (response.ok ? response.json() : null))
      .then(setInvoices);
  }, [org]);

  if (!org || invoices === null) return null;
  return (
    <Section
      id="usage-by-index"
      title="Usage by index"
      description="What each index used each month, at list prices, newest first."
    >
      {invoices.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No usage yet.</p>
      )}
      {invoices.map((invoice) => (
        <div key={invoice.month}>
          <button
            type="button"
            className="block w-full text-left hover:bg-hover"
            onClick={() => setOpen(open === invoice.month ? null : invoice.month)}
          >
            <Row>
              <Glyph icon={ReceiptText} />
              <Lines
                title={
                  <>
                    {monthName(invoice.month)}
                    {invoice.status === "open" && <Tag>So far</Tag>}
                  </>
                }
              />
              <span className="tabular-nums">{money(invoice.total_cents)}</span>
              <ChevronDown
                className={cx(
                  "size-4 text-muted-foreground transition-transform",
                  open === invoice.month && "rotate-180",
                )}
              />
            </Row>
          </button>
          {open === invoice.month && <InvoiceLines org={org.id} month={invoice.month} />}
        </div>
      ))}
    </Section>
  );
}

function InvoiceLines({ org, month }: { org: string; month: string }) {
  const [lines, setLines] = useState<Line[] | null>(null);
  useEffect(() => {
    fetch(invoicesApi(org, `/${month}`))
      .then((response) => (response.ok ? response.json() : { lines: [] }))
      .then((invoice) => setLines(invoice.lines));
  }, [org, month]);

  if (lines === null) return null;
  return (
    <div className="divide-y divide-border/60 border-t border-border/60 bg-muted/30">
      {lines.map((line) => (
        <div
          key={`${line.index}/${line.item}`}
          className="flex items-center gap-3.5 py-2.5 pr-4 pl-[66px] text-[13px]"
        >
          <span className="w-48 truncate font-mono">{line.index}</span>
          <span className="flex-1 truncate text-muted-foreground">
            {amount(line.quantity)} {UNITS[line.item] ?? line.item} at ${line.unit_price}
          </span>
          <span className="tabular-nums">{money(line.amount_cents)}</span>
        </div>
      ))}
    </div>
  );
}
