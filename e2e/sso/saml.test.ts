// The checks on SAML responses, against the real console. The test plays the
// identity provider with a key of its own, so it can sign, leave unsigned,
// tamper with and replay responses at will.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { inflateRawSync } from "node:zlib";

import { SignedXml } from "xml-crypto";

import { Browser, CONSOLE, owner, startSso, unique } from "./browser.ts";

const IDP = "https://idp.forged.test";
// A new domain each run, under one the console vouches for.
const DOMAIN = `run-${unique()}.forged.test`;

function keyPair() {
  const dir = mkdtempSync(join(tmpdir(), "sso-idp-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=forged-idp",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      join(dir, "cert.pem"),
    ],
    { stdio: "ignore" },
  );
  return {
    key: readFileSync(join(dir, "key.pem"), "utf8"),
    cert: readFileSync(join(dir, "cert.pem"), "utf8"),
  };
}

const idp = keyPair();
const stranger = keyPair();
const body = (pem: string) => pem.replace(/-----[^-]+-----|\s/g, "");

const metadata = `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${IDP}">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data><ds:X509Certificate>${body(idp.cert)}</ds:X509Certificate></ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${IDP}/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

let admin: Awaited<ReturnType<typeof owner>>;
let connection: { id: string; sp: Record<string, string> };

before(async () => {
  admin = await owner();
  const made = await admin.browser.json("POST", "/api/sso", {
    type: "saml",
    domains: DOMAIN,
    metadata,
  });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const listed = await admin.browser.json("GET", "/api/sso");
  connection = listed.body.find((c: { id: string }) => c.id === made.body.id);
  const on = await admin.browser.json("PATCH", `/api/sso/${connection.id}`, { enabled: true });
  assert.equal(on.status, 200, JSON.stringify(on.body));
});

/** Starts a sign-in and reads the request the console sends to the IdP. */
async function request(email = `eve@${DOMAIN}`) {
  const browser = new Browser();
  const started = await startSso(browser, email);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const url = new URL(started.body.url);
  assert.equal(url.origin + url.pathname, `${IDP}/sso`);
  const xml = inflateRawSync(
    Buffer.from(url.searchParams.get("SAMLRequest")!, "base64"),
  ).toString();
  return {
    browser,
    id: /\bID="([^"]+)"/.exec(xml)![1]!,
    relayState: url.searchParams.get("RelayState") ?? "",
  };
}

interface Options {
  email?: string;
  inResponseTo?: string | null;
  audience?: string;
  notOnOrAfter?: Date;
  sign?: "assertion" | "none" | "stranger";
  /** Changes the XML after it is signed. */
  tamper?: (xml: string) => string;
}

function assertion(id: string, email: string, o: Options, now: Date) {
  const later = (o.notOnOrAfter ?? new Date(now.getTime() + 5 * 60_000)).toISOString();
  const inResponseTo = o.inResponseTo === null ? "" : ` InResponseTo="${o.inResponseTo}"`;
  return `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${now.toISOString()}"><saml:Issuer>${IDP}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData${inResponseTo} NotOnOrAfter="${later}" Recipient="${connection.sp["ACS URL"]}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${new Date(now.getTime() - 60_000).toISOString()}" NotOnOrAfter="${later}"><saml:AudienceRestriction><saml:Audience>${o.audience ?? connection.sp["Entity ID"]}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="_s${unique()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
}

function sign(xml: string, key: string, cert: string) {
  const signer = new SignedXml({
    privateKey: key,
    publicCert: cert,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  signer.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  signer.computeSignature(xml, {
    location: {
      reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      action: "after",
    },
  });
  return signer.getSignedXml();
}

/** A SAML response as the IdP would send it. */
function response(requestId: string | null, o: Options = {}) {
  const now = new Date();
  let inner = assertion(
    `_a${unique()}`,
    o.email ?? `eve@${DOMAIN}`,
    {
      inResponseTo: requestId,
      ...o,
    },
    now,
  );
  if (o.sign !== "none") {
    const keys = o.sign === "stranger" ? stranger : idp;
    inner = sign(inner, keys.key, keys.cert);
  }
  const inResponseTo = requestId ? ` InResponseTo="${requestId}"` : "";
  let xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${unique()}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${connection.sp["ACS URL"]}"${inResponseTo}><saml:Issuer>${IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${inner}</samlp:Response>`;
  if (o.tamper) xml = o.tamper(xml);
  return Buffer.from(xml).toString("base64");
}

/** Posts a response to the console's ACS, as the IdP's page would. */
async function post(browser: Browser, samlResponse: string, relayState: string) {
  return browser.go(connection.sp["ACS URL"]!, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: IDP },
    body: new URLSearchParams({ SAMLResponse: samlResponse, RelayState: relayState }).toString(),
  });
}

async function refused(o: Options, email?: string) {
  const { browser, id, relayState } = await request(email);
  const page = await post(browser, response(id, o), relayState);
  assert.equal(await browser.session(), null, `signed in at ${page.url}`);
  return page;
}

test("a signed response for this request signs in, and only once", async () => {
  const { browser, id, relayState } = await request();
  const signed = response(id);
  const page = await post(browser, signed, relayState);
  assert.equal(page.url, `${CONSOLE}/`);
  const session = await browser.session();
  assert.equal(session?.user.email, `eve@${DOMAIN}`);
  assert.equal(session?.session.ssoOrg, admin.org);

  // The same response again, even with the cookies of its own sign-in, is refused.
  const replayer = new Browser();
  await post(replayer, signed, relayState);
  assert.equal(await replayer.session(), null);
});

test("an unsigned assertion is refused", async () => {
  await refused({ sign: "none" });
});

test("an assertion signed by another key is refused", async () => {
  await refused({ sign: "stranger" });
});

test("an assertion changed after signing is refused", async () => {
  await refused({
    tamper: (xml) => xml.replaceAll(`eve@${DOMAIN}`, `boss@${DOMAIN}`),
  });
});

test("an assertion for another service provider is refused", async () => {
  await refused({ audience: "https://other-sp.example/metadata" });
});

test("an expired assertion is refused", async () => {
  await refused({ notOnOrAfter: new Date(Date.now() - 10 * 60_000) });
});

test("a response to no request, or to another one, is refused", async () => {
  // IdP-initiated: nothing asked for it.
  const browser = new Browser();
  await post(browser, response(null, { inResponseTo: null }), "");
  assert.equal(await browser.session(), null);
  // A request id the console never made.
  await refused({ inResponseTo: `_${unique()}` });
});

test("a signed assertion wrapped beside a forged one is refused", async () => {
  await refused({
    tamper: (xml) => {
      const forged = assertion(`_f${unique()}`, `boss@${DOMAIN}`, {}, new Date());
      return xml.replace("</samlp:Status>", `</samlp:Status>${forged}`);
    },
  });
});

test("an email outside the connection's domains is refused", async () => {
  await refused({ email: "mallory@elsewhere.dev" });
});

test("a turned-off connection signs no one in", async () => {
  const { browser, id, relayState } = await request();
  await admin.browser.json("PATCH", `/api/sso/${connection.id}`, { enabled: false });
  await post(browser, response(id), relayState);
  assert.equal(await browser.session(), null);
  assert.equal((await startSso(new Browser(), `eve@${DOMAIN}`)).status, 404);
  await admin.browser.json("PATCH", `/api/sso/${connection.id}`, { enabled: true });
});
