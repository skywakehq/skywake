import { emailOn } from "@skywake/email";
import { hostedEnv, readEnv } from "@skywake/env";

// The hosted service's settings. Self-hosted installs set none of them.
export const hosted = readEnv(hostedEnv);

export const EMAIL = emailOn(hosted);

const pair = (clientId?: string, clientSecret?: string) =>
  clientId && clientSecret ? { clientId, clientSecret } : undefined;
const google = pair(hosted.GOOGLE_CLIENT_ID, hosted.GOOGLE_CLIENT_SECRET);
const github = pair(hosted.GITHUB_CLIENT_ID, hosted.GITHUB_CLIENT_SECRET);

/** Google and GitHub sign-in, each on only when its id and secret are set. */
export const SOCIAL = { ...(google && { google }), ...(github && { github }) };

export type Social = keyof typeof SOCIAL;

/** What the sign-in pages may offer. */
export const authOptions = () => ({
  email: EMAIL,
  social: Object.keys(SOCIAL) as Social[],
});

export type AuthOptions = ReturnType<typeof authOptions>;
