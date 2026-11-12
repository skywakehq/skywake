const WORDS: Record<string, string> = {
  INVALID_TOKEN: "That link has expired or was already used. Sign in to get a new one.",
  TOKEN_EXPIRED: "That link has expired. Sign in to get a new one.",
  unsolicited_response:
    "Start single sign-on from this page, not from your identity provider's app list.",
};

/** What went wrong, from the `error` a sign-in or email link came back with. */
export function authError(query: URLSearchParams) {
  const code = query.get("error") ?? "";
  return WORDS[code] ?? (query.get("error_description") ?? code).replaceAll("_", " ");
}

/**
 * The sign-in page's query for a signed-out person who asked for `url`: where
 * to go after, and the `error` a failed email link came back with.
 */
export function signInQuery(url: { pathname: string; search: string }) {
  const query = new URLSearchParams({ next: url.pathname + url.search });
  const error = new URLSearchParams(url.search).get("error");
  if (error) query.set("error", error);
  return query;
}
