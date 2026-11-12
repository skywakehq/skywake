/**
 * What to tell an admin when a domain could not be verified. Better Auth
 * says "Try again later" whatever the cause; nearly always the TXT record is
 * missing or has not spread yet.
 */
export function verifyFailure(error: unknown, id: string, domain: string) {
  const code = (error as { body?: { code?: string } })?.body?.code;
  if (code === "DOMAIN_VERIFICATION_FAILED") {
    const name = domain.split(",")[0]!.trim();
    return `No matching TXT record at _skywake-sso-${id}.${name}. Add the record shown here; DNS changes can take a few minutes to appear.`;
  }
  return error instanceof Error ? error.message : "The DNS record was not found";
}
