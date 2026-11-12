/** Writes one structured log line. Never pass keys, tokens or file contents. */
export type Log = (
  entry: { level: "info" | "warn" | "error"; msg: string } & Record<string, unknown>,
) => void;

export const jsonLog: Log = (entry) => {
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), ...entry }) + "\n");
};
