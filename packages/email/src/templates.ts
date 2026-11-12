export type Rendered = { subject: string; html: string; text: string };

export function verifyEmail({ url }: { url: string }): Rendered {
  return render({
    subject: "Verify your email for Skywake",
    heading: "Verify your email",
    lines: ["Confirm this is your email to finish making your Skywake account."],
    action: { label: "Verify email", url },
    footer: "The link works for one hour. If you didn't sign up, you can ignore this email.",
  });
}

export function resetPassword({ url }: { url: string }): Rendered {
  return render({
    subject: "Reset your Skywake password",
    heading: "Reset your password",
    lines: ["Someone asked to reset the password for your Skywake account."],
    action: { label: "Choose a new password", url },
    footer: "The link works for one hour. If you didn't ask, your password stays as it is.",
  });
}

export function invitation({
  org,
  inviter,
  role,
  url,
}: {
  org: string;
  inviter: string;
  role: string;
  url: string;
}): Rendered {
  org = withoutLinks(org);
  inviter = withoutLinks(inviter);
  return render({
    subject: `${inviter} invited you to ${org} on Skywake`,
    heading: `Join ${org} on Skywake`,
    lines: [`${inviter} invited you to the ${org} organization as ${article(role)} ${role}.`],
    action: { label: "Accept invitation", url },
    footer: "If you weren't expecting this, you can ignore this email.",
  });
}

export function waitlist({ selfHostUrl }: { selfHostUrl: string }): Rendered {
  return render({
    subject: "You're on the Skywake Cloud waitlist",
    heading: "You're on the list",
    lines: [
      "Thanks for joining the waitlist for Skywake Cloud. We'll email you once, when it opens.",
      "Until then, you can run all of Skywake yourself, for free.",
    ],
    action: { label: "Self-host Skywake", url: selfHostUrl },
    footer: "If you didn't sign up, you can ignore this email. You won't hear from us again.",
  });
}

export function withoutLinks(text: string) {
  const plain = text
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, "")
    .replace(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b\S*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return plain || "Someone";
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

type Parts = {
  subject: string;
  heading: string;
  lines: string[];
  action: { label: string; url: string };
  footer: string;
};

function render({ subject, heading, lines, action, footer }: Parts): Rendered {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif";
  const paragraph = (text: string) =>
    `<p style="margin:0 0 16px;font-size:14px;line-height:22px;color:#171717">${escape(text)}</p>`;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
<tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;font-family:${font}">
<tr><td style="padding-bottom:24px;font-size:13px;font-weight:600;letter-spacing:-0.01em;color:#171717">Skywake</td></tr>
<tr><td>
<h1 style="margin:0 0 16px;font-size:18px;line-height:26px;font-weight:500;color:#171717">${escape(heading)}</h1>
${lines.map(paragraph).join("\n")}
<a href="${escape(action.url)}" style="display:inline-block;margin:8px 0 24px;padding:9px 16px;background:#171717;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none">${escape(action.label)}</a>
<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:#737373">Or open this link: <a href="${escape(action.url)}" style="color:#737373;word-break:break-all">${escape(action.url)}</a></p>
<p style="margin:0;padding-top:16px;border-top:1px solid #e5e5e5;font-size:13px;line-height:20px;color:#737373">${escape(footer)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = [
    heading,
    "",
    ...lines.flatMap((line) => [line, ""]),
    `${action.label}: ${action.url}`,
    "",
    footer,
    "",
  ].join("\n");
  return { subject, html, text };
}

function escape(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
