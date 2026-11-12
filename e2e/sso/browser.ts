// A small browser for the tests: it keeps cookies per host and port, follows
// redirects, and submits the forms identity providers send.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

export const CONSOLE = process.env.CONSOLE_URL ?? "http://localhost:3200";
export const KEYCLOAK = process.env.KEYCLOAK_URL ?? "http://localhost:8380";

export const unique = () => randomBytes(4).toString("hex");

export interface Page {
  status: number;
  url: string;
  text: string;
  location: string | null;
}

export class Browser {
  readonly #jar = new Map<string, Map<string, string>>();

  cookie(url: string, name: string) {
    return this.#jar.get(new URL(url).host)?.get(name);
  }

  /** One request, without following redirects. */
  async send(url: string, init: RequestInit = {}): Promise<Page> {
    const target = new URL(url, CONSOLE);
    const headers = new Headers(init.headers);
    const cookies = this.#jar.get(target.host);
    if (cookies?.size) {
      headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    }
    // Better Auth checks where a request with cookies comes from.
    if (init.method && init.method !== "GET" && !headers.has("origin")) {
      headers.set("origin", target.origin);
    }
    const response = await fetch(target, { ...init, headers, redirect: "manual" });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const at = pair!.indexOf("=");
      const name = pair!.slice(0, at).trim();
      const value = pair!.slice(at + 1).trim();
      const jar = this.#jar.get(target.host) ?? new Map<string, string>();
      this.#jar.set(target.host, jar);
      const expired = attributes.some((a) => /max-age=0\b/i.test(a.trim()));
      if (expired || value === "") jar.delete(name);
      else jar.set(name, value);
    }
    const location = response.headers.get("location");
    return {
      status: response.status,
      url: target.href,
      text: await response.text(),
      location: location && new URL(location, target).href,
    };
  }

  /** A request that follows redirects to the end. */
  async go(url: string, init: RequestInit = {}): Promise<Page> {
    let page = await this.send(url, init);
    for (let hops = 0; page.location && hops < 20; hops++) page = await this.send(page.location);
    return page;
  }

  /** Sends JSON to the console. */
  async json(method: string, path: string, body?: unknown) {
    const page = await this.send(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: page.status, body: page.text ? JSON.parse(page.text) : null };
  }

  /** Submits the page's form, with `fields` filled in, and follows redirects. */
  async submit(page: Page, fields: Record<string, string> = {}, follow = true) {
    const form = /<form\b[^>]*>[\s\S]*?<\/form>/i.exec(page.text)?.[0];
    assert.ok(form, `no form on ${page.url}: ${page.text.slice(0, 300)}`);
    const action = new URL(decode(/action="([^"]*)"/i.exec(form)![1]!), page.url).href;
    const values = new URLSearchParams();
    for (const [input] of form.matchAll(/<input\b[^>]*>/gi)) {
      const name = /name="([^"]*)"/i.exec(input)?.[1];
      if (name) values.set(name, decode(/value="([^"]*)"/i.exec(input)?.[1] ?? ""));
    }
    for (const [name, value] of Object.entries(fields)) values.set(name, value);
    const init = {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: new URL(page.url).origin,
      },
      body: values.toString(),
    };
    return follow ? this.go(action, init) : this.send(action, init);
  }

  /** Who the console says is signed in, or null. */
  async session() {
    const { body } = await this.json("GET", "/api/auth/get-session");
    return body as {
      user: { id: string; email: string };
      session: { activeOrganizationId: string | null; ssoOrg: string | null };
    } | null;
  }
}

const decode = (text: string) =>
  text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x3d;", "=")
    .replaceAll("&#61;", "=")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

/** A new person with a password, an organization of their own, and its admin. */
export async function owner(email = `owner-${unique()}@owners.dev`) {
  const browser = new Browser();
  const signUp = await browser.json("POST", "/api/auth/sign-up/email", {
    email,
    password: "a-long-password",
    name: "Owner",
  });
  assert.equal(signUp.status, 200, JSON.stringify(signUp.body));
  const slug = `org-${unique()}`;
  const org = await browser.json("POST", "/api/auth/organization/create", { name: slug, slug });
  assert.equal(org.status, 200, JSON.stringify(org.body));
  const active = await browser.json("POST", "/api/auth/organization/set-active", {
    organizationId: org.body.id,
  });
  assert.equal(active.status, 200, JSON.stringify(active.body));
  return { browser, org: org.body.id as string, email };
}

/** Starts single sign-on for an email: the console answers with where to go. */
export async function startSso(browser: Browser, email: string) {
  const started = await browser.json("POST", "/api/auth/sign-in/sso", {
    email,
    callbackURL: `${CONSOLE}/`,
    errorCallbackURL: `${CONSOLE}/sign-in`,
  });
  return started;
}
