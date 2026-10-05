import { appendFile } from "node:fs/promises";

import { EmailClient } from "@azure/communication-email";

// Sending mail, behind one small interface so the request handler can be tested
// with a fake and nothing else knows Azure exists. The payload shape is the one
// the backend uses (backend/app/services/email_outbox.py).

export type MailMessage = { to: string; subject: string; text: string; html?: string; replyTo?: string };

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

const SEND_TIMEOUT_MS = 20_000;

export class AcsMailer implements Mailer {
  private client: EmailClient;

  constructor(
    connectionString: string,
    private from: string,
  ) {
    this.client = new EmailClient(connectionString);
  }

  async send(message: MailMessage): Promise<void> {
    const poller = await this.client.beginSend({
      senderAddress: this.from,
      recipients: { to: [{ address: message.to }] },
      content: { subject: message.subject, plainText: message.text, ...(message.html ? { html: message.html } : {}) },
      ...(message.replyTo ? { replyTo: [{ address: message.replyTo }] } : {}),
    });

    const result = await Promise.race([
      poller.pollUntilDone(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Sending the email timed out")), SEND_TIMEOUT_MS)),
    ]);

    if (result.status !== "Succeeded") throw new Error(`The email service reported ${result.status}`);
  }
}

/** Writes each message as a JSON line to a file. For tests and local runs only; see createMailer. */
export class FileMailer implements Mailer {
  constructor(private file: string) {}

  async send(message: MailMessage): Promise<void> {
    await appendFile(this.file, JSON.stringify({ at: new Date().toISOString(), ...message }) + "\n", "utf8");
  }
}

/** Prints the message instead of sending it. Development only. */
export class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    console.log(`[mail not sent: no email service configured] to=${message.to} subject=${message.subject}`);
  }
}

type Env = Record<string, string | undefined>;

/**
 * The mailer this deployment uses, or null when there is none (the form then
 * tells the visitor to email instead).
 *   - ALLOW_FILE_MAILER=1 + MAIL_OUTBOX_FILE: a file, for tests. It must never be set on a real deployment.
 *   - ACS_CONNECTION_STRING + MAIL_FROM_ADDRESS: Azure Communication Services.
 *   - nothing, outside production: the console.
 */
export function createMailer(env: Env): Mailer | null {
  if (env.ALLOW_FILE_MAILER === "1" && env.MAIL_OUTBOX_FILE) return new FileMailer(env.MAIL_OUTBOX_FILE);

  if (env.ACS_CONNECTION_STRING && env.MAIL_FROM_ADDRESS) return new AcsMailer(env.ACS_CONNECTION_STRING, env.MAIL_FROM_ADDRESS);

  return env.NODE_ENV === "production" ? null : new ConsoleMailer();
}
