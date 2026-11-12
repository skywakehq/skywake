import { execFileSync } from "node:child_process";

import {
  METER,
  METERS,
  meterEvent,
  meterKey,
  PAID,
  PLAN,
  planKey,
  unitCents,
} from "../src/features/billing/catalog.ts";
import { PORTAL_TAG } from "../src/features/billing/stripe.ts";

type Json = Record<string, any>;
type Form = Record<string, string | number | boolean>;

const live = process.argv.includes("--live");

function stripe(method: "get" | "post", path: string, form: Form = {}): Json {
  const args = [method, path, ...(live ? ["--live"] : [])];
  for (const [key, value] of Object.entries(form)) args.push("-d", `${key}=${value}`);
  const out = execFileSync("stripe", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const json = JSON.parse(out) as Json;
  if (json.error) throw new Error(`${method} ${path}: ${json.error.message}`);
  if (json.livemode === true && !live) throw new Error("the Stripe CLI answered in live mode");
  return json;
}

function find(path: string, form: Form, match: (item: Json) => boolean) {
  return (stripe("get", path, { limit: 100, ...form }).data as Json[]).find(match) ?? null;
}

function product(id: string, name: string, description: string) {
  const found = find("/v1/products", { active: true }, (item) => item.id === id);
  if (found) return found.id as string;
  try {
    return stripe("get", `/v1/products/${id}`).id as string;
  } catch {
    return stripe("post", "/v1/products", { id, name, description }).id as string;
  }
}

function price(lookupKey: string, wanted: Form, same: (found: Json) => boolean) {
  const found = find("/v1/prices", { "lookup_keys[]": lookupKey, active: true }, () => true);
  if (found && same(found)) {
    console.log(`  ${lookupKey}: ${found.id}, unchanged`);
    return found.id as string;
  }
  const made = stripe("post", "/v1/prices", {
    ...wanted,
    currency: "usd",
    lookup_key: lookupKey,
    transfer_lookup_key: true,
  });
  console.log(`  ${lookupKey}: ${made.id}${found ? `, replaces ${found.id}` : ""}`);
  return made.id as string;
}

function meter(name: string) {
  const event = meterEvent(name as (typeof METERS)[number]);
  const found = find(
    "/v1/billing/meters",
    { status: "active" },
    (item) => item.event_name === event,
  );
  if (found) return found.id as string;
  return stripe("post", "/v1/billing/meters", {
    display_name: `Skywake ${METER[name as (typeof METERS)[number]].name}`,
    event_name: event,
    "default_aggregation[formula]": "sum",
    "customer_mapping[type]": "by_id",
    "customer_mapping[event_payload_key]": "stripe_customer_id",
    "value_settings[event_payload_key]": "value",
  }).id as string;
}

console.log(`Stripe ${live ? "LIVE" : "test"} mode`);
console.log("Meters and their prices");
const meterPrices: string[] = [];
for (const name of METERS) {
  const spec = METER[name];
  const meterId = meter(name);
  const productId = product(meterKey(name), spec.name, `$${spec.dollars} per ${spec.per}`);
  const cents = unitCents(name);
  meterPrices.push(
    price(
      meterKey(name),
      {
        product: productId,
        nickname: `${spec.name}, per ${spec.unit}`,
        "recurring[interval]": "month",
        "recurring[usage_type]": "metered",
        "recurring[meter]": meterId,
        billing_scheme: "per_unit",
        unit_amount_decimal: cents,
      },
      (found) =>
        found.recurring?.meter === meterId &&
        Number(found.unit_amount_decimal) === Number(cents) &&
        found.product === productId,
    ),
  );
}

console.log("Plans");
const planProducts: { product: string; price: string }[] = [];
for (const plan of PAID) {
  const spec = PLAN[plan];
  const productId = product(
    planKey(plan),
    `Skywake ${spec.name}`,
    `Monthly minimum of $${spec.minimumCents! / 100}, credited against usage`,
  );
  const priceId = price(
    planKey(plan),
    {
      product: productId,
      nickname: `${spec.name} monthly minimum`,
      "recurring[interval]": "month",
      "recurring[usage_type]": "licensed",
      unit_amount: spec.minimumCents!,
    },
    (found) => found.unit_amount === spec.minimumCents && found.product === productId,
  );
  planProducts.push({ product: productId, price: priceId });
}

console.log("Customer portal");
const portal = find("/v1/billing_portal/configurations", { active: true }, (item) =>
  Boolean(item.metadata?.[PORTAL_TAG]),
);
const portalForm: Form = {
  "business_profile[headline]": "Skywake billing",
  "features[customer_update][enabled]": true,
  "features[customer_update][allowed_updates][]": "email",
  "features[invoice_history][enabled]": true,
  "features[payment_method_update][enabled]": true,
  "features[subscription_cancel][enabled]": true,
  "features[subscription_cancel][mode]": "at_period_end",
  "features[subscription_cancel][proration_behavior]": "none",
  [`metadata[${PORTAL_TAG}]`]: "1",
};
const configuration = portal
  ? stripe("post", `/v1/billing_portal/configurations/${portal.id}`, portalForm)
  : stripe("post", "/v1/billing_portal/configurations", portalForm);
console.log(`  ${configuration.id}`);
console.log(`Done: ${meterPrices.length} metered prices, ${planProducts.length} plans`);
