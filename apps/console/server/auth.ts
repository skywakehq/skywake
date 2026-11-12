import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { betterAuth, type DBPrimitive, type GenericEndpointContext } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { jwt, organization, twoFactor } from "better-auth/plugins";
import { invitation, resetPassword, send, verifyEmail } from "@skywake/email";
import { learnCaller, recordAuth } from "./audit";
import { authPool } from "./db";
import { leaverOf, revokeKeysOf } from "./member-keys";
import { renameFirst, reserveOrg } from "./org-names";
import { EMAIL, hosted, SOCIAL } from "./hosted";
import { domainOf, openSecrets, PRIVATE_IDP_ORIGINS, sealSecrets, ssoOrgsFor } from "./sso-policy";
import { withBase } from "@/lib/zone";

export const ISSUER = "skywake-console";

type Provider = {
  providerId: string;
  organizationId: string | null;
  domain: string;
  domainVerified: boolean;
  enabled: boolean;
};

const ssoPlugin = sso({
  // People who sign in through an organization's connection join it as members.
  organizationProvisioning: { defaultRole: "member" },
  // A connection signs no one in until its domain is proved by a DNS record.
  domainVerification: { enabled: true, tokenPrefix: "skywake-sso" },
  saml: {
    // Every response must answer a request we sent, so a response can't be
    // replayed or sent to us unasked. IdP-initiated sign-in stays off.
    enableInResponseToValidation: true,
    allowIdpInitiated: false,
    // Where such a refused response lands, so the sign-in page can say why.
    // `next build` loads this file without BETTER_AUTH_URL; the server sets it.
    idpInitiatedCallbackUrl: new URL(
      withBase("/sign-in"),
      process.env.BETTER_AUTH_URL ?? "http://localhost:3100",
    ).href,
    requireTimestamps: true,
    clockSkew: 2 * 60_000,
    algorithms: { onDeprecated: "reject" },
  },
  schema: {
    ssoProvider: {
      additionalFields: {
        enabled: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },
  },
  // Runs inside the sign-in transaction, after the IdP's signature is checked.
  async resolveUser({ providerId, providerUser }, { database }) {
    const provider = await database.findOne<Provider>({
      model: "ssoProvider",
      where: [{ field: "providerId", value: providerId }],
    });
    if (!provider?.enabled) {
      return { action: "reject", code: "SSO_DISABLED", message: "This connection is turned off" };
    }
    if (!allowedDomains(provider).includes(domainOf(providerUser.email) ?? "")) {
      return {
        action: "reject",
        code: "SSO_EMAIL_DOMAIN",
        message: "The identity provider sent an email outside the connection's domains",
      };
    }
    // An account made with this email before anyone proved they own it, as
    // by a password sign-up, loses its password, passkeys and sessions here.
    // The identity provider has now proved the email, and whoever made the
    // account first must not keep a way in.
    const email = providerUser.email.toLowerCase();
    const user = await database.findOne<{ id: string; emailVerified: boolean }>({
      model: "user",
      where: [{ field: "email", value: email }],
    });
    if (user && !user.emailVerified) {
      for (const model of ["account", "session", "passkey", "twoFactor"]) {
        await database.deleteMany({ model, where: [{ field: "userId", value: user.id }] });
      }
      await database.update({
        model: "user",
        where: [{ field: "id", value: user.id }],
        update: { emailVerified: true, twoFactorEnabled: false },
      });
    }
    return { action: "continue" };
  },
});

// Client secrets and signing keys are kept encrypted with the auth secret.
const sealed = {
  input: (value: DBPrimitive) => (typeof value === "string" ? sealSecrets(value) : value),
  output: (value: DBPrimitive) => (typeof value === "string" ? openSecrets(value) : value),
};
ssoPlugin.schema.ssoProvider.fields.oidcConfig.transform = sealed;
ssoPlugin.schema.ssoProvider.fields.samlConfig.transform = sealed;

export const auth = betterAuth({
  appName: "Skywake",
  // BETTER_AUTH_URL is the console's host; the base path follows it.
  basePath: withBase("/api/auth"),
  database: authPool,
  // Email is set only on the hosted service. There, people prove their email
  // before they can sign in, and can reset a forgotten password.
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: EMAIL,
    revokeSessionsOnPasswordReset: true,
    // Not awaited, so how long the answer takes doesn't tell who has an account.
    sendResetPassword: EMAIL
      ? async ({ user, url }) => {
          mail(user.email, resetPassword({ url })).catch(console.error);
        }
      : undefined,
  },
  emailVerification: EMAIL
    ? {
        sendOnSignUp: true,
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: ({ user, url }) =>
          mail(user.email, verifyEmail({ url })),
      }
    : undefined,
  socialProviders: SOCIAL,
  // Origins of identity providers on a private network, like a local Keycloak.
  // Public ones need no entry.
  trustedOrigins: PRIVATE_IDP_ORIGINS,
  // Connections are managed only through /api/sso, which checks more.
  disabledPaths: [
    "/sso/register",
    "/sso/update-provider",
    "/sso/delete-provider",
    "/sso/providers",
    "/sso/get-provider",
    "/sso/request-domain-verification",
    "/sso/verify-domain",
  ],
  session: {
    additionalFields: {
      // The organization whose single sign-on made this session, if any.
      ssoOrg: { type: "string", required: false, input: false },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/email" || ctx.path === "/sign-up/email") {
        await refuseIfSsoRequired(String(ctx.body?.email ?? ""));
      }
      await learnCaller(ctx);
      if (ctx.path === "/sign-in/sso") return { context: { body: await chooseProvider(ctx) } };
    }),
    // Sign-ins, two-factor, passkeys and member changes, refused ones too.
    after: createAuthMiddleware(async (ctx) => {
      recordAuth(ctx);
      // Leaving runs no member hooks, so a person's keys are revoked here.
      const left = leaverOf(ctx);
      if (left) await revokeKeysOf(left.org, left.user);
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // Every way of signing in makes a session, so this is where single
        // sign-on is required: passkeys and two-factor end here too.
        async before(session, ctx) {
          const providerId = ctx?.path.startsWith("/sso/") ? ctx.params?.providerId : undefined;
          if (providerId) {
            const provider = await findProvider(ctx!, providerId);
            const org = provider?.organizationId ?? null;
            // The connection's verified domain proves the email.
            await ctx!.context.internalAdapter.updateUser(session.userId, { emailVerified: true });
            return { data: { ...session, ssoOrg: org, activeOrganizationId: org } };
          }
          const user = ctx && (await ctx.context.internalAdapter.findUserById(session.userId));
          await refuseIfSsoRequired(user?.email ?? "");
        },
      },
    },
  },
  plugins: [
    organization({
      sendInvitationEmail: EMAIL
        ? ({ id, email, role, organization, inviter }) =>
            mail(
              email,
              invitation({
                org: organization.name,
                inviter: inviter.user.name,
                role,
                url: new URL(withBase(`/invite/${id}`), process.env.BETTER_AUTH_URL).href,
              }),
            )
        : undefined,
      organizationHooks: {
        // The API keeps its own list of organizations, and their names unique.
        beforeCreateOrganization: async ({ organization }) => ({
          data: { ...organization, id: await reserveOrg(organization.name ?? "") },
        }),
        beforeUpdateOrganization: async ({ organization, member }) =>
          renameFirst(member.organizationId, organization),
        // A person's API keys go with them.
        afterRemoveMember: ({ member, organization }) =>
          revokeKeysOf(organization.id, member.userId),
      },
    }),
    // The API checks these tokens against our public keys.
    jwt({ jwt: { issuer: ISSUER, audience: ISSUER, expirationTime: "5m" } }),
    passkey({ rpName: "Skywake" }),
    twoFactor(),
    ssoPlugin,
    nextCookies(),
  ],
});

function mail(to: string, email: { subject: string; html: string; text: string }) {
  return send({ to, ...email }, hosted);
}

export const allowedDomains = (provider: { domain: string }) =>
  provider.domain.split(",").map((domain) => domain.trim().toLowerCase());

async function refuseIfSsoRequired(email: string) {
  if ((await ssoOrgsFor(email)).length > 0) {
    throw new APIError("FORBIDDEN", {
      code: "SSO_REQUIRED",
      message: "Your organization signs you in with single sign-on. Use “Continue with SSO”.",
    });
  }
}

function findProvider(ctx: GenericEndpointContext, providerId: string) {
  return ctx.context.adapter.findOne<Provider>({
    model: "ssoProvider",
    where: [{ field: "providerId", value: providerId }],
  });
}

/**
 * Picks the connection for an SSO sign-in: the one named, or the one for the
 * email's domain. Only turned-on connections with a verified domain count, so
 * someone else's unverified claim to a domain can't get in the way.
 */
async function chooseProvider(ctx: GenericEndpointContext) {
  const body = ctx.body as { providerId?: string; email?: string };
  const domain = domainOf(body.email ?? "");
  const usable = (provider: Provider | null): provider is Provider =>
    Boolean(provider?.enabled && provider.domainVerified);
  let found: Provider[];
  if (body.providerId) {
    const provider = await findProvider(ctx, body.providerId);
    found = usable(provider) ? [provider] : [];
  } else {
    const all = await ctx.context.adapter.findMany<Provider>({
      model: "ssoProvider",
      where: [{ field: "enabled", value: true }],
    });
    found = all.filter((p) => usable(p) && domain && allowedDomains(p).includes(domain));
  }
  if (found.length === 0) {
    throw new APIError("NOT_FOUND", { message: "There is no single sign-on for this email" });
  }
  // Two organizations may both prove one domain. Prefer the one that requires it.
  const required = domain ? await ssoOrgsFor(body.email!) : [];
  const chosen = found.find((p) => required.includes(p.organizationId ?? "")) ?? found[0]!;
  return {
    ...ctx.body,
    providerId: chosen.providerId,
    email: undefined,
    domain: undefined,
    organizationSlug: undefined,
    loginHint: body.email,
  };
}
