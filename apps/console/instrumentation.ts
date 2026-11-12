// Runs once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { consoleEnv, readEnv } = await import("@skywake/env");
  const env = readEnv(consoleEnv);
  // First, so no request is read before its real address is noted.
  const { noteClientAddresses, trustedProxies } = await import("./server/address");
  noteClientAddresses(trustedProxies(env.TRUSTED_PROXIES));
  const { prepareDatabase } = await import("./server/setup");
  await prepareDatabase();
}
