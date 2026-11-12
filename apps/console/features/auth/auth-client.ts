"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { withBase } from "@/lib/zone";

export const authClient = createAuthClient({
  basePath: withBase("/api/auth"),
  plugins: [
    organizationClient(),
    passkeyClient(),
    ssoClient(),
    twoFactorClient({ onTwoFactorRedirect: () => location.assign(withBase("/two-factor")) }),
  ],
});
