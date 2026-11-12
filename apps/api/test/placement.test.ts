import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import type { Log } from "../src/http/log.ts";
import {
  checkPlacement,
  databaseRegion,
  liveProbe,
  parseStore,
  type Probe,
} from "../src/placement.ts";

const near = 0.8;
const far = 80;

function probe(overrides: Partial<Probe> = {}): Probe {
  return {
    bucketRegion: async () => "eu-central-1",
    bucketTrip: async () => near,
    databaseTrip: async () => near,
    ...overrides,
  };
}

function capture() {
  const logs: Parameters<Log>[0][] = [];
  return { logs, log: ((entry) => logs.push(entry)) satisfies Log };
}

const placement = {
  region: "eu-central-1",
  store: "s3://agents/prod",
  database:
    "postgres://u:p@db.abc123.eu-central-1.rds.amazonaws.com:5432/skywake?sslmode=no-verify",
};

test("everything in one region: no warning", async () => {
  const { logs, log } = capture();
  assert.deepEqual(await checkPlacement(placement, probe(), log), []);
  assert.deepEqual(
    logs.map((entry) => entry.level),
    ["info"],
  );
});

test("a bucket in another region names commits", async () => {
  const { logs, log } = capture();
  const warnings = await checkPlacement(
    placement,
    probe({ bucketRegion: async () => "us-east-1", bucketTrip: async () => far }),
    log,
  );
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /agents is in us-east-1, not eu-central-1/);
  assert.match(warnings[0]!, /commits/);
  assert.match(warnings[1]!, /80\.0 ms a round trip/);
  assert.ok(logs.every((entry) => entry.level === "warn" && entry.check === "placement"));
});

test("a far Postgres names writes", async () => {
  const { log } = capture();
  const warnings = await checkPlacement(
    { ...placement, database: "postgres://u:p@db.abc123.us-west-2.rds.amazonaws.com/skywake" },
    probe({ databaseTrip: async () => far }),
    log,
  );
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /Postgres is in us-west-2, not eu-central-1/);
  assert.match(warnings[0]!, /every API write/);
  assert.match(warnings[1]!, /Postgres takes 80\.0 ms/);
});

test("slowness is the median, so one slow trip is not enough", async () => {
  const { log } = capture();
  const times = [200, 1, 1, 90, 1, 1];
  const warnings = await checkPlacement(
    placement,
    probe({ bucketTrip: async () => times.shift() ?? 1 }),
    log,
  );
  assert.deepEqual(warnings, []);
});

test("a failing probe never throws", async () => {
  const { log } = capture();
  const broken = async () => {
    throw new Error("unreachable");
  };
  const warnings = await checkPlacement(
    placement,
    probe({ bucketRegion: broken, bucketTrip: broken, databaseTrip: broken }),
    log,
  );
  assert.deepEqual(warnings, []);
});

test("a store that names its region is trusted over the bucket's answer", async () => {
  const { log } = capture();
  const warnings = await checkPlacement(
    { ...placement, store: "s3://agents?region=ap-south-1" },
    probe(),
    log,
  );
  assert.match(warnings[0]!, /in ap-south-1/);
});

test("stores and host names", () => {
  assert.deepEqual(parseStore("s3://agents/prod/x"), { bucket: "agents", region: null });
  assert.deepEqual(parseStore("s3://agents?region=eu-west-1"), {
    bucket: "agents",
    region: "eu-west-1",
  });
  assert.equal(parseStore("/var/skywake"), null);
  assert.equal(databaseRegion(placement.database), "eu-central-1");
  assert.equal(
    databaseRegion("postgres://u:p@prod.cluster-abc.ap-southeast-2.rds.amazonaws.com/db"),
    "ap-southeast-2",
  );
  assert.equal(databaseRegion("postgres://u:p@postgres/skywake"), null);
  assert.equal(databaseRegion("not a url"), null);
});

test("the live probe times a real round trip and skips non-AWS regions", async (t) => {
  const server = createServer((_, response) => response.writeHead(403).end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const live = liveProbe(
    { store: "s3://agents", region: "us-east-1", endpoint: `http://127.0.0.1:${port}` },
    async () => {},
  );
  assert.equal(await live.bucketRegion(), null);
  const ms = await live.bucketTrip();
  assert.ok(ms > 0 && ms < 1000, `round trip ${ms} ms`);
});
