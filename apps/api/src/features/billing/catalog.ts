export const INDEX_METERS = [
  "storage",
  "writes",
  "queries",
  "embeddings",
  "reranks",
  "pinned",
] as const;
export const FILES_METERS = ["files_storage", "files_egress"] as const;
export const METERS = [...INDEX_METERS, ...FILES_METERS] as const;
export type Meter = (typeof METERS)[number];
export type IndexMeter = (typeof INDEX_METERS)[number];

export const PLANS = ["free", "launch", "scale", "enterprise"] as const;
export type Plan = (typeof PLANS)[number];
export type PaidPlan = "launch" | "scale";

export const FEATURES = ["pinning", "sso", "audit_log", "ip_allowlist", "customer_keys"] as const;
export type Feature = (typeof FEATURES)[number];

export type Limit = Meter | "stored" | "indexes" | "files_stored" | "filesystems";

const KiB = 1024n;
const MiB = KiB * KiB;
const GiB = MiB * KiB;
const TiB = GiB * KiB;
const PiB = TiB * KiB;
const HOURS_PER_MONTH = 730n;
const SECONDS_PER_HOUR = 3600n;

export interface MeterSpec {
  name: string;
  dollars: string;
  per: string;
  perRaw: bigint;
  unit: string;
  unitRaw: bigint;
  shownAs: string;
  shownRaw: bigint;
}

export const METER: Record<Meter, MeterSpec> = {
  storage: {
    name: "Storage",
    dollars: "0.25",
    per: "GB-month",
    perRaw: GiB * HOURS_PER_MONTH,
    unit: "MB-hour",
    unitRaw: MiB,
    shownAs: "GB-months",
    shownRaw: GiB * HOURS_PER_MONTH,
  },
  writes: {
    name: "Writes",
    dollars: "1.50",
    per: "GB written",
    perRaw: GiB,
    unit: "MB",
    unitRaw: MiB,
    shownAs: "GB written",
    shownRaw: GiB,
  },
  queries: {
    name: "Queries",
    dollars: "0.75",
    per: "PB scanned",
    perRaw: PiB,
    unit: "GB scanned",
    unitRaw: GiB,
    shownAs: "TB scanned",
    shownRaw: TiB,
  },
  embeddings: {
    name: "Embeddings",
    dollars: "0.01",
    per: "1,000 texts",
    perRaw: 1000n,
    unit: "text",
    unitRaw: 1n,
    shownAs: "texts",
    shownRaw: 1n,
  },
  reranks: {
    name: "Reranks",
    dollars: "0.02",
    per: "1,000 documents",
    perRaw: 1000n,
    unit: "document",
    unitRaw: 1n,
    shownAs: "documents",
    shownRaw: 1n,
  },
  pinned: {
    name: "Pinned replicas",
    dollars: "0.001",
    per: "GB-hour",
    perRaw: GiB * SECONDS_PER_HOUR,
    unit: "MB-hour",
    unitRaw: MiB * SECONDS_PER_HOUR,
    shownAs: "GB-hours",
    shownRaw: GiB * SECONDS_PER_HOUR,
  },
  files_storage: {
    name: "Files storage",
    dollars: "0.10",
    per: "GB-month",
    perRaw: GiB * HOURS_PER_MONTH,
    unit: "MB-hour",
    unitRaw: MiB,
    shownAs: "GB-months",
    shownRaw: GiB * HOURS_PER_MONTH,
  },
  files_egress: {
    name: "File downloads",
    dollars: "0.12",
    per: "GB downloaded",
    perRaw: GiB,
    unit: "MB",
    unitRaw: MiB,
    shownAs: "GB downloaded",
    shownRaw: GiB,
  },
};

export interface PlanSpec {
  name: string;
  minimumCents: number | null;
  features: readonly Feature[];
  limits: Partial<Record<Limit, bigint>>;
}

const ALL_FEATURES = FEATURES;

export const PLAN: Record<Plan, PlanSpec> = {
  free: {
    name: "Free",
    minimumCents: 0,
    features: [],
    limits: {
      stored: GiB,
      writes: GiB,
      queries: 10n * TiB,
      embeddings: 10_000n,
      reranks: 1_000n,
      indexes: 3n,
      files_stored: 5n * GiB,
      files_egress: 10n * GiB,
      filesystems: 3n,
    },
  },
  launch: {
    name: "Launch",
    minimumCents: 1600,
    features: ["pinning"],
    limits: {},
  },
  scale: {
    name: "Scale",
    minimumCents: 12_800,
    features: ALL_FEATURES,
    limits: {},
  },
  enterprise: {
    name: "Enterprise",
    minimumCents: null,
    features: ALL_FEATURES,
    limits: {},
  },
};

export const PAID: readonly PaidPlan[] = ["launch", "scale"];

export const PAST_DUE_GRACE_DAYS = 7;

export const planKey = (plan: PaidPlan) => `skywake_plan_${plan}_monthly`;
export const meterKey = (meter: Meter) => `skywake_meter_${meter}`;
export const meterEvent = (meter: Meter) => `skywake_${meter}`;

export const lowestPlanWith = (feature: Feature): Plan =>
  PLANS.find((plan) => PLAN[plan].features.includes(feature))!;

const SCALE = 12;

function scaled(decimal: string, places: number) {
  const [whole = "0", fraction = ""] = decimal.split(".");
  if (fraction.length > places) throw new Error(`\`${decimal}\` has too many decimals`);
  return BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, "0") || "0");
}

const roundedDivide = (a: bigint, b: bigint) => (2n * a + b) / (2n * b);

function decimal(value: bigint, places: number) {
  const text = value.toString().padStart(places + 1, "0");
  const whole = text.slice(0, -places);
  const fraction = text.slice(-places).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function unitCents(meter: Meter) {
  const spec = METER[meter];
  const dollars = scaled(spec.dollars, SCALE);
  return decimal(roundedDivide(dollars * 100n * spec.unitRaw, spec.perRaw), SCALE);
}

export function rawCents(meter: Meter, raw: bigint, price = METER[meter].dollars) {
  const dollars = scaled(price, SCALE);
  return Number(roundedDivide(raw * dollars * 100n, METER[meter].perRaw * 10n ** BigInt(SCALE)));
}

export function shownPrice(meter: Meter, price = METER[meter].dollars) {
  const spec = METER[meter];
  const dollars = scaled(price, SCALE);
  return Number(decimal(roundedDivide(dollars * spec.shownRaw, spec.perRaw), SCALE));
}

export const PRICE = /^\d+(\.\d{1,12})?$/;

export function shown(meter: Meter, raw: bigint) {
  const shownRaw = METER[meter].shownRaw;
  return Number(roundedDivide(raw * 1_000_000n, shownRaw)) / 1_000_000;
}

export const limitOf = (plan: Plan, limit: Limit) => PLAN[plan].limits[limit] ?? null;
export const has = (plan: Plan, feature: Feature) => PLAN[plan].features.includes(feature);
