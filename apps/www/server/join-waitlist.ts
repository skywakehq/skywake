"use server";

import { join } from "./waitlist";

export type WaitlistState = { status: "idle" | "joined" | "invalid" | "off" | "error" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function joinWaitlist(_: WaitlistState, form: FormData): Promise<WaitlistState> {
  if (form.get("website")) return { status: "joined" };

  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return { status: "invalid" };
  const use = String(form.get("use") ?? "")
    .trim()
    .slice(0, 500);

  try {
    return { status: (await join(email, use)) ? "joined" : "off" };
  } catch (error) {
    console.error("Could not join the waitlist", error);
    return { status: "error" };
  }
}
