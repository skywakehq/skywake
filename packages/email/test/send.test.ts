import assert from "node:assert/strict";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { test } from "node:test";

import { emailOn, send } from "../src/index.ts";

const email = { to: "ada@example.com", subject: "Hello", html: "<p>Hi</p>", text: "Hi" };

test("email is off with neither Resend nor SMTP set", async () => {
  assert.equal(emailOn({}), false);
  assert.equal(emailOn({ RESEND_API_KEY: "", SMTP_URL: "" }), false);
  await assert.rejects(send(email, {}), /Email is off/);
});

test("send needs a from address", async () => {
  await assert.rejects(send(email, { SMTP_URL: "smtp://localhost:1" }), /EMAIL_FROM/);
});

test("send posts to Resend when its key is set, even with SMTP set too", async (t) => {
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "1" }), { status: 200 });
  });

  await send(email, {
    RESEND_API_KEY: "re_test",
    SMTP_URL: "smtp://localhost:1",
    EMAIL_FROM: "Skywake <hi@example.com>",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.resend.com/emails");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer re_test");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    from: "Skywake <hi@example.com>",
    ...email,
    to: ["ada@example.com"],
  });
});

test("send reports what Resend refused", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("bad from", { status: 422 }));
  await assert.rejects(
    send(email, { RESEND_API_KEY: "re_test", EMAIL_FROM: "a@b.c" }),
    /Resend refused the email \(422\): bad from/,
  );
});

test("send delivers over SMTP when only SMTP is set", async (t) => {
  const { port, received, close } = await fakeSmtp();
  t.after(close);

  await send(email, {
    SMTP_URL: `smtp://localhost:${port}?ignoreTLS=true`,
    EMAIL_FROM: "Skywake <hi@example.com>",
  });

  const message = (await received).replaceAll("\r\n", "\n");
  assert.match(message, /^From: Skywake <hi@example.com>$/m);
  assert.match(message, /^To: ada@example.com$/m);
  assert.match(message, /^Subject: Hello$/m);
  assert.match(message, /<p>Hi<\/p>/);
});

/** An SMTP server that takes one message and keeps it. */
async function fakeSmtp() {
  let resolve!: (message: string) => void;
  const received = new Promise<string>((done) => (resolve = done));
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let data: string | null = null;
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk) => {
      for (const line of chunk.toString().split("\r\n")) {
        if (data !== null) {
          if (line === ".") {
            resolve(data);
            data = null;
            socket.write("250 queued\r\n");
          } else data += `${line}\r\n`;
        } else if (/^(EHLO|HELO)/i.test(line)) socket.write("250 fake\r\n");
        else if (/^(MAIL|RCPT|RSET|NOOP)/i.test(line)) socket.write("250 ok\r\n");
        else if (/^DATA/i.test(line)) {
          data = "";
          socket.write("354 go on\r\n");
        } else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    received,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}
