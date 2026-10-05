import type { DemoRequest } from "@/lib/demoSchema";
import type { MailMessage } from "@/lib/mailer";
import type { Translator } from "@/lib/i18n";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The country as a readable name, falling back to the code. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The mail that tells the owner about a request. It is internal, so it is plain
 * English and not in the catalogue. Reply-To is the visitor, so answering it
 * answers them. Every visitor-supplied value is escaped in the HTML part.
 */
export function ownerMessage(data: DemoRequest, to: string): MailMessage {
  const rows: [string, string][] = [
    ["Name", data.name],
    ["Company", data.company],
    ["Email", data.email],
    ["Country", `${countryName(data.country)} (${data.country})`],
    ["Fleet size", `${data.fleet} vehicles`],
  ];
  const message = data.message || "(no message)";

  const text = [...rows.map(([label, value]) => `${label}: ${value}`), "", "Message:", message].join("\n");
  const html = [
    "<table>",
    ...rows.map(([label, value]) => `<tr><td><b>${escapeHtml(label)}</b></td><td>${escapeHtml(value)}</td></tr>`),
    "</table>",
    `<p><b>Message</b></p><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
  ].join("");

  return { to, subject: `Demo request: ${data.company} (${data.fleet} vehicles)`, text, html, replyTo: data.email };
}

/** The acknowledgement the visitor gets: plain, no tracking, no marketing, replies reach the owner. */
export function autoReply(data: DemoRequest, t: Translator, brandName: string, replyTo?: string): MailMessage {
  const text = t("email.reply.body", { name: data.name, brand: brandName });
  const html = text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");

  return { to: data.email, subject: t("email.reply.subject"), text, html, ...(replyTo ? { replyTo } : {}) };
}
