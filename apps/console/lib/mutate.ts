"use client";

/**
 * Waits for the server's answer to a Zero change, and throws its error.
 * The browser shows the change at once; this is for what happens after.
 */
export async function settled(result: { server: Promise<unknown> }) {
  const answer = (await result.server) as
    { type?: string; error?: { message?: string } } | undefined;
  if (answer?.type === "error") throw new Error(answer.error?.message ?? "The change failed");
}
