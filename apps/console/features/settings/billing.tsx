"use client";

import { AlertTriangle, Check, ChevronDown, CreditCard, Gauge, ReceiptText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@skywake/ui/components/dialog";
import { type ComponentProps, type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/features/auth/auth-client";
import { Button, cx } from "@/components/kit";
import { act, Glyph, Lines, Row, Section, Tag } from "./parts";
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

type Offer = {
  plan: Plan;
  name: string;
  minimum_cents: number | null;
  storage_gb: number | null;
  features: string[];
};

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

const diskOf = (index: string) => index.replace(/\.files$/, "");

const UNITS: Record<string, string> = {
  storage: "GB-months stored",
  writes: "GB written",
  queries: "TB scanned",
  embeddings: "texts embedded",
  reranks: "rows reranked",
  pinned: "GB-hours pinned",
};

const size = (gb: number | null) =>
  gb === null ? "Unlimited" : gb >= 1024 ? `${amount(gb / 1024)} TB` : `${amount(gb)} GB`;

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
        priceCents: offer.minimum_cents ?? 0,
        features: [
          `${size(offer.storage_gb)} of storage`,
          ...offer.features.map((feature) => FEATURES[feature] ?? feature),
        ],
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
        id="plan"
        title="Plan"
        description={
          paying
            ? `This period, ${day(billing.period_start)} to ${day(billing.period_end)}.`
            : "Everything on your disks and in search counts toward storage."
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
        <Limit name="Storage" used={billing.stored.gb} limit={billing.stored.limit_gb} unit="GB" />
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
      <Checkout choice={buying} onClose={() => setBuying(null)} onPaid={paid} />
    </>
  );
}

function PlanRow({ billing }: { billing: Billing }) {
  const minimum = billing.minimum_cents;
  const detail =
    billing.plan === "free"
      ? "No card needed. Upgrade for more storage and paid features."
      : billing.plan === "enterprise"
        ? "Custom terms."
        : `${money(minimum ?? 0)} a month, renews ${day(billing.period_end)}.`;
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

const PITCH: Record<"free" | Paid, string> = {
  free: "For trying Skywake out.",
  launch: "For agents in production.",
  scale: "For larger workloads.",
};

const PAID_NAME: Record<Paid, string> = { launch: "Launch", scale: "Scale" };

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
  const includes = (offer: Offer): string[] => {
    const storage = `${size(offer.storage_gb)} of storage`;
    if (offer.plan === "free")
      return [storage, "Unlimited disks and branches", "Search on every disk"];
    if (offer.plan === "launch") return [storage, "Everything in Free", "Pinned replicas"];
    return [storage, "Everything in Launch"];
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-0 sm:max-w-[880px]"
        showCloseButton={false}
      >
        <div className="grid gap-7 p-7 max-sm:p-4">
          <div>
            <DialogTitle className="text-[20px] font-medium tracking-[-0.025em]">
              {paying ? "Change plan" : "Upgrade"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm">
              One flat price a month. Nothing is metered.
            </DialogDescription>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {billing.plans
              .filter((offer) => offer.plan !== "enterprise")
              .map((offer) => (
                <PlanCard
                  key={offer.plan}
                  offer={offer}
                  lines={includes(offer)}
                  billing={billing}
                  onPick={onPick}
                  onCancel={onCancel}
                />
              ))}
          </div>
          {paying && (
            <p className="-mt-3 text-[13px] text-muted-foreground">
              A larger plan starts now, with the rest of this period charged. A smaller one starts
              when the period ends.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanCard({
  offer,
  lines,
  billing,
  onPick,
  onCancel,
}: {
  offer: Offer;
  lines: string[];
  billing: Billing;
  onPick: (plan: Paid) => void;
  onCancel: () => void;
}) {
  const plan = offer.plan as "free" | Paid;
  const paying = billing.plan === "launch" || billing.plan === "scale";
  const here = plan === billing.plan && !billing.next_plan;
  const leaving = plan === "free" && billing.cancel_at_period_end;
  const lit = plan === (paying ? billing.plan : "launch");
  const muted = lit ? "text-background/60" : "text-muted-foreground";

  let action: ReactNode = null;
  if (here)
    action = (
      <PlanButton tone={lit ? "inverse" : "soft"} disabled>
        Current plan
      </PlanButton>
    );
  else if (plan === "free") {
    if (paying)
      action = (
        <PlanButton tone="soft" onClick={onCancel}>
          {leaving ? `Stay on ${billing.name}` : "Move to Free"}
        </PlanButton>
      );
  } else
    action = (
      <PlanButton tone={lit ? "inverse" : "solid"} onClick={() => onPick(plan)}>
        {paying ? "Switch" : "Choose"} {PAID_NAME[plan]}
      </PlanButton>
    );

  return (
    <div
      className={cx(
        "flex flex-col rounded-[20px] p-6 max-sm:p-5",
        lit ? "bg-foreground text-background" : "bg-tint",
      )}
    >
      <div className="flex h-6 items-center justify-between gap-2">
        <span className="text-[15px] font-medium">{offer.name}</span>
        {leaving && <span className={cx("text-xs", muted)}>From {day(billing.period_end)}</span>}
      </div>
      <p className={cx("text-[13px]", muted)}>{PITCH[plan]}</p>
      <div className="mt-6 flex items-baseline gap-1.5">
        <span className="text-[36px] leading-none font-medium tracking-[-0.04em] tabular-nums">
          ${(offer.minimum_cents ?? 0) / 100}
        </span>
        <span className={cx("text-[13px]", muted)}>{plan === "free" ? "no card" : "a month"}</span>
      </div>
      <div className="mt-6 h-10">{action}</div>
      <ul className="mt-6 grid gap-2.5 text-[13px]">
        {lines.map((line) => (
          <li key={line} className="flex items-center gap-2.5">
            <span
              className={cx(
                "grid size-4 shrink-0 place-items-center rounded-full",
                lit ? "bg-background/15" : "bg-green/15 text-green",
              )}
            >
              <Check className="size-2.5" strokeWidth={3} />
            </span>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanButton({
  tone,
  ...props
}: { tone: "solid" | "inverse" | "soft" } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "flex h-10 w-full items-center justify-center rounded-xl text-[13px] font-medium transition-colors disabled:cursor-default",
        tone === "solid" && "bg-foreground text-background hover:bg-foreground/85",
        tone === "inverse" && "bg-background text-foreground hover:bg-background/85",
        tone === "soft" && "bg-active text-foreground hover:bg-hover disabled:hover:bg-active",
        props.disabled && "opacity-70",
      )}
    />
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
      id="usage-by-disk"
      title="Usage by disk"
      description="What each disk used each month, at list prices, newest first."
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
    <div className="bg-muted/30">
      {lines.map((line) => (
        <div
          key={`${line.index}/${line.item}`}
          className="flex items-center gap-3.5 py-2.5 pr-4 pl-[66px] text-[13px]"
        >
          <span className="w-48 truncate">{diskOf(line.index)}</span>
          <span className="flex-1 truncate text-muted-foreground">
            {amount(line.quantity)} {UNITS[line.item] ?? line.item} at ${line.unit_price}
          </span>
          <span className="tabular-nums">{money(line.amount_cents)}</span>
        </div>
      ))}
    </div>
  );
}
