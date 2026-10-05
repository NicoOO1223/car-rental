import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AcsMailer, ConsoleMailer, FileMailer, createMailer } from "@/lib/mailer";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("choosing a mailer", () => {
  it("uses Azure Communication Services when it is configured", () => {
    const mailer = createMailer({
      NODE_ENV: "production",
      ACS_CONNECTION_STRING: "endpoint=https://example.communication.azure.com/;accesskey=dGVzdA==",
      MAIL_FROM_ADDRESS: "hello@example.com",
    });

    expect(mailer).toBeInstanceOf(AcsMailer);
  });

  it("has no mailer in production when nothing is configured: the form then says to email instead", () => {
    expect(createMailer({ NODE_ENV: "production" })).toBeNull();
    expect(createMailer({ NODE_ENV: "production", ACS_CONNECTION_STRING: "x" })).toBeNull();
  });

  it("prints to the console on a developer's machine", () => {
    expect(createMailer({ NODE_ENV: "development" })).toBeInstanceOf(ConsoleMailer);
  });

  it("only uses the file mailer when explicitly allowed, and never beats a refusal to configure", () => {
    expect(createMailer({ NODE_ENV: "production", MAIL_OUTBOX_FILE: "/tmp/x" })).toBeNull();
    expect(createMailer({ NODE_ENV: "production", ALLOW_FILE_MAILER: "1", MAIL_OUTBOX_FILE: "/tmp/x" })).toBeInstanceOf(FileMailer);
    expect(createMailer({ NODE_ENV: "production", ALLOW_FILE_MAILER: "1" })).toBeNull();
  });
});

describe("the file mailer", () => {
  it("appends one JSON line per message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mailer-"));
    dirs.push(dir);
    const file = join(dir, "outbox.jsonl");
    const mailer = new FileMailer(file);

    await mailer.send({ to: "a@example.com", subject: "One", text: "first" });
    await mailer.send({ to: "b@example.com", subject: "Two", text: "second", replyTo: "c@example.com" });

    const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ to: "a@example.com", subject: "One" });
    expect(lines[1]).toMatchObject({ to: "b@example.com", replyTo: "c@example.com" });
  });
});
