import type { Log } from "./http/log.ts";

// Skywake's speeds assume the API, its bucket and Postgres share a region:
// a commit makes several bucket requests one after another, and every API
// write waits on Postgres. This check measures both at startup and warns
// when either is in another region or far away. It never stops the server.

/** Above this, a round trip is not inside one region. */
export const SLOW_MS = 5;
const SAMPLES = 5;

export interface Probe {
  /** The bucket's region, or null when the store cannot say (not AWS). */
  bucketRegion(): Promise<string | null>;
  /** One request to the bucket, in milliseconds. */
  bucketTrip(): Promise<number>;
  /** One query to Postgres, in milliseconds. */
  databaseTrip(): Promise<number>;
}

export interface Placement {
  /** AWS_REGION: where the API expects to be. */
  region: string;
  /** The default region's store, such as s3://bucket/folder. */
  store: string;
  /** The Postgres URL. */
  database: string;
}

/** The bucket of an s3:// store, and the region the store names, if any. */
export function parseStore(store: string): { bucket: string; region: string | null } | null {
  if (!store.startsWith("s3://")) return null;
  const [path = "", query = ""] = store.slice("s3://".length).split("?");
  const bucket = path.split("/")[0];
  if (!bucket) return null;
  return { bucket, region: new URLSearchParams(query).get("region") };
}

/** The region in an RDS or Aurora host name, such as db.abc.eu-central-1.rds.amazonaws.com. */
export function databaseRegion(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return /\.([a-z]{2}(?:-[a-z]+)+-\d+)\.rds\.amazonaws\.com(?:\.cn)?$/.exec(host)?.[1] ?? null;
}

/** The middle of a few round trips, after one to open the connection. */
async function median(trip: () => Promise<number>) {
  await trip();
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) times.push(await trip());
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

/** Measures where the bucket and Postgres are, and returns (and logs) each warning. */
export async function checkPlacement(placement: Placement, probe: Probe, log: Log) {
  const warnings: string[] = [];
  const warn = (msg: string, details: Record<string, unknown>) => {
    warnings.push(msg);
    log({ level: "warn", msg, ...details });
  };
  const expected = placement.region;
  const store = parseStore(placement.store);

  if (store) {
    const region = store.region ?? (await probe.bucketRegion().catch(() => null));
    if (region && region !== expected) {
      warn(
        `the bucket ${store.bucket} is in ${region}, not ${expected} (AWS_REGION): ` +
          "commits, checkouts and cold reads make several bucket requests one after another, " +
          "and each pays the trip between regions. Run the API in the bucket's region.",
        { check: "placement", bucket: store.bucket, bucketRegion: region, region: expected },
      );
    }
    const ms = await median(() => probe.bucketTrip()).catch(() => null);
    if (ms !== null && ms > SLOW_MS) {
      warn(
        `the bucket ${store.bucket} takes ${ms.toFixed(1)} ms a round trip (over ${SLOW_MS} ms): ` +
          "commits, checkouts and cold reads will be slower. Run the API in the bucket's region.",
        { check: "placement", bucket: store.bucket, roundTripMs: Number(ms.toFixed(1)) },
      );
    }
  }

  const region = databaseRegion(placement.database);
  if (region && region !== expected) {
    warn(
      `Postgres is in ${region}, not ${expected} (AWS_REGION): every API write waits on it, ` +
        "so each pays the trip between regions. Put Postgres in the API's region.",
      { check: "placement", databaseRegion: region, region: expected },
    );
  }
  const ms = await median(() => probe.databaseTrip()).catch(() => null);
  if (ms !== null && ms > SLOW_MS) {
    warn(
      `Postgres takes ${ms.toFixed(1)} ms a round trip (over ${SLOW_MS} ms): ` +
        "every API write waits on it, so writes will be slower. Put Postgres in the API's region.",
      { check: "placement", roundTripMs: Number(ms.toFixed(1)) },
    );
  }

  if (warnings.length === 0)
    log({ level: "info", msg: "placement: bucket and Postgres are close" });
  return warnings;
}

/** The real probe: plain HTTPS to the bucket and `SELECT 1` on the pool. */
export function liveProbe(
  options: { store: string; region: string; endpoint: string | null },
  query: () => Promise<unknown>,
): Probe {
  const store = parseStore(options.store);
  const timed = async (work: () => Promise<unknown>) => {
    const start = performance.now();
    await work();
    return performance.now() - start;
  };
  const head = (url: string) =>
    fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(3000) });
  const regional = options.endpoint
    ? `${options.endpoint.replace(/\/+$/, "")}/${store?.bucket}`
    : `https://s3.${store?.region ?? options.region}.amazonaws.com/${store?.bucket}`;

  return {
    // AWS names a bucket's region in every answer about it, even a refusal.
    async bucketRegion() {
      if (!store || (options.endpoint && !options.endpoint.includes("amazonaws.com"))) return null;
      const response = await head(`https://s3.amazonaws.com/${store.bucket}`);
      return response.headers.get("x-amz-bucket-region");
    },
    // Unsigned, so the bucket answers 403 at once: the trip, not the work.
    bucketTrip: () => timed(() => head(regional)),
    databaseTrip: () => timed(query),
  };
}
