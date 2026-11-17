// SPDX-License-Identifier: AGPL-3.0-or-later
// Outgoing mail (M1 slice 4b). POSTMODEM_MAIL_URL picks the transport:
//   log://                  write messages to the log (default; fine for trying things out)
//   smtp://user:pass@host:587   STARTTLS when the server offers it
//   smtps://user:pass@host:465  implicit TLS
// Messages are sent by the worker from the job queue, never inside a web request.
import type { Config, Logger } from "@postmodem/core";
import { createTransport } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Recipient's language, recorded for debugging; the text is already translated. */
  locale?: string;
}

export interface Mailer {
  readonly kind: "log" | "smtp";
  send(message: MailMessage): Promise<void>;
  verify(): Promise<void>;
}

export function defaultSender(config: Config, boardName: string): string {
  if (config.mailFrom) return config.mailFrom;
  const host = new URL(config.publicUrl).hostname;
  return `"${boardName.replace(/["\\\r\n]/g, "")}" <noreply@${host}>`;
}

export function createMailer(config: Config, log: Logger, from: () => string): Mailer {
  if (config.mailUrl.startsWith("log:")) {
    return {
      kind: "log",
      async send(m) {
        log.info("mail (log transport)", { from: from(), to: m.to, subject: m.subject, text: m.text });
      },
      async verify() {},
    };
  }
  const transport = createTransport(config.mailUrl);
  return {
    kind: "smtp",
    async send(m) {
      await transport.sendMail({
        from: from(),
        to: m.to,
        subject: m.subject,
        text: m.text,
        headers: { "Auto-Submitted": "auto-generated" },
      });
    },
    async verify() {
      try {
        await transport.verify();
      } catch (e) {
        // A refused connection is an AggregateError with an empty message; name the cause.
        const err = e as Error & { code?: string; errors?: { code?: string }[] };
        const host = new URL(config.mailUrl).host;
        throw new Error(`${host}: ${err.message || err.code || err.errors?.[0]?.code || "unreachable"}`);
      }
    },
  };
}
