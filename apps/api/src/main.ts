import { createServer } from "node:http";

import { serve } from "@hono/node-server";
import { loadEnv } from "@skywake/env";

import { createApp, services } from "./app.ts";
import { keepFor } from "./audit/retention.ts";
import { ConsoleTokens } from "./auth/tokens.ts";
import { loadConfig } from "./config.ts";
import { connect, migrate } from "./db/client.ts";
import { jsonLog as log } from "./http/log.ts";
import { Metrics } from "./http/metrics.ts";
import { checkPlacement, liveProbe } from "./placement.ts";

loadEnv();
const config = loadConfig();
const { db, pool } = connect(config.database, config.databasePool);
await migrate(pool);
const tokens = config.jwks ? ConsoleTokens.remote(config.jwks.url, config.jwks) : null;
const metrics = new Metrics(true);
const served = services(config, db, tokens, { log, metrics });
const app = createApp(served);
served.pinning.start();
served.leases.start();
served.builds?.start();
served.limiter?.start();
served.billing?.start();
served.syncer.start();
served.deleter.start();
await served.changes.start();
const stopRetention = keepFor(db, config.auditDays, log);

const server = serve({ fetch: app.fetch, ...config.listen }, (address) => {
  log({ level: "info", msg: "listening", address: `${address.address}:${address.port}` });
});

if (config.placementCheck) {
  const [, store] = config.regions[0]!;
  const placement = { region: config.s3.region, store, database: config.database };
  const probe = liveProbe({ ...config.s3, store }, () => pool.query("SELECT 1"));
  checkPlacement(placement, probe, log).catch((error: unknown) =>
    log({ level: "warn", msg: "placement check failed", error: String(error) }),
  );
}

const metricsServer =
  config.metricsListen &&
  createServer(async (request, response) => {
    if (request.url !== "/metrics") return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": metrics.registry.contentType });
    response.end(await metrics.registry.metrics());
  }).listen(config.metricsListen.port, config.metricsListen.hostname, () => {
    log({ level: "info", msg: "metrics listening", address: config.metricsListen });
  });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    metricsServer?.close();
    stopRetention();
    server.close(
      () =>
        void Promise.allSettled([
          served.pinning.stop(),
          served.syncer.stop(),
          served.deleter.stop(),
          served.builds?.stop(),
          served.leases.stop(),
          served.changes.stop(),
          served.usage.flush(),
          served.billing?.stop(),
          served.audit.flush(),
        ])
          .finally(() => pool.end())
          .then(() => process.exit(0)),
    );
  });
}
