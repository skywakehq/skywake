import type { Transporter } from "nodemailer";

export * from "./templates.ts";

export type Email = { to: string; subject: string; html: string; text: string };

export type EmailEnv = {
  RESEND_API_KEY?: string | undefined;
  SMTP_URL?: string | undefined;
  EMAIL_FROM?: string | undefined;
};

export function emailOn(env: EmailEnv = process.env as EmailEnv) {
  return Boolean(env.RESEND_API_KEY || env.SMTP_URL);
}

export async function send(email: Email, env: EmailEnv = process.env as EmailEnv) {
  if (!emailOn(env)) throw new Error("Email is off: set RESEND_API_KEY or SMTP_URL");
  if (!env.EMAIL_FROM) throw new Error("EMAIL_FROM is not set");
  const message = { from: env.EMAIL_FROM, ...email };
  if (env.RESEND_API_KEY) await sendWithResend(message, env.RESEND_API_KEY);
  else await sendWithSmtp(message, env.SMTP_URL!);
}

async function sendWithResend(message: Email & { from: string }, key: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ ...message, to: [message.to] }),
  });
  if (!response.ok) {
    throw new Error(`Resend refused the email (${response.status}): ${await response.text()}`);
  }
}

const transports = new Map<string, Transporter>();

async function sendWithSmtp(message: Email & { from: string }, url: string) {
  let transport = transports.get(url);
  if (!transport) {
    const { createTransport } = await import("nodemailer");
    transport = createTransport(url);
    transports.set(url, transport);
  }
  await transport.sendMail(message);
}
