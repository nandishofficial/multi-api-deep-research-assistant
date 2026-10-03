import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import MailComposer from "nodemailer/lib/mail-composer";
import { getGoogleAccessToken, GoogleAuthorizationError } from "@/server/auth/google-token";
import { getEnv } from "@/server/env";
import { ClassifiedError, classifyError } from "@/server/util/errors";
import { createLogger } from "@/server/util/logger";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailMessage {
  /** Recipient (the signed-in user's Gmail address). */
  to: string;
  /** Owner of the research, used to look up their Google OAuth token. */
  userId: string;
  subject: string;
  html: string;
  text: string;
  attachments: EmailAttachment[];
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id?: string }>;
}

const log = createLogger("email");

/** Builds an RFC 5322 message (multipart/mixed: text + html + attachments). */
export async function buildMime(message: EmailMessage, from: string): Promise<Buffer> {
  const composer = new MailComposer({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
  });
  return composer.compile().build();
}

async function httpError(res: Response, what: string): Promise<ClassifiedError> {
  const body = await res.text().catch(() => "");
  const err = Object.assign(new Error(`${what} failed (${res.status}): ${body.slice(0, 500)}`), { status: res.status });
  return classifyError(err);
}

/**
 * Sends from the user's own Gmail account to themselves, using the
 * `gmail.send` scope granted at sign-in (refresh token kept by Better Auth).
 */
export class GmailTransport implements EmailTransport {
  readonly name = "gmail";

  async send(message: EmailMessage) {
    let token: string;
    try {
      token = await getGoogleAccessToken(message.userId);
    } catch (err) {
      if (err instanceof GoogleAuthorizationError) throw new ClassifiedError("permanent", err.message, { cause: err });
      throw classifyError(err);
    }
    const mime = await buildMime(message, message.to);
    // The media-upload endpoint accepts messages up to 35 MB (vs ~5 MB for JSON `raw`).
    const res = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "message/rfc822" },
      body: new Uint8Array(mime),
    });
    if (!res.ok) throw await httpError(res, "Gmail send");
    const json = (await res.json()) as { id?: string };
    return { id: json.id };
  }
}

export class ResendTransport implements EmailTransport {
  readonly name = "resend";

  async send(message: EmailMessage) {
    const env = getEnv();
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      throw new ClassifiedError("permanent", "RESEND_API_KEY and EMAIL_FROM must be set for EMAIL_PROVIDER=resend");
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
      }),
    });
    if (!res.ok) throw await httpError(res, "Resend send");
    const json = (await res.json()) as { id?: string };
    return { id: json.id };
  }
}

export class SmtpTransport implements EmailTransport {
  readonly name = "smtp";

  async send(message: EmailMessage) {
    const env = getEnv();
    if (!env.SMTP_URL || !env.EMAIL_FROM) {
      throw new ClassifiedError("permanent", "SMTP_URL and EMAIL_FROM must be set for EMAIL_PROVIDER=smtp");
    }
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport(env.SMTP_URL);
    try {
      const info = await transporter.sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments,
      });
      return { id: info.messageId };
    } catch (err) {
      throw classifyError(err);
    }
  }
}

/** Development transport: writes the message to .data/outbox as an .eml file. */
export class ConsoleTransport implements EmailTransport {
  readonly name = "console";

  async send(message: EmailMessage) {
    const dir = path.join(process.cwd(), ".data", "outbox");
    await mkdir(dir, { recursive: true });
    const id = `${Date.now()}-${message.to.replace(/[^a-z0-9]+/gi, "_")}`;
    const file = path.join(dir, `${id}.eml`);
    await writeFile(file, await buildMime(message, "Deep Research Assistant <noreply@localhost>"));
    for (const a of message.attachments) await writeFile(path.join(dir, `${id}-${a.filename}`), a.content);
    log.info("email written to outbox", { to: message.to, subject: message.subject, file });
    return { id };
  }
}

export function createEmailTransport(kind: "gmail" | "resend" | "smtp" | "console"): EmailTransport {
  switch (kind) {
    case "gmail":
      return new GmailTransport();
    case "resend":
      return new ResendTransport();
    case "smtp":
      return new SmtpTransport();
    case "console":
      return new ConsoleTransport();
  }
}
