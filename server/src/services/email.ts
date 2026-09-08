import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      // Mailpit accepts anything; only pass auth when it is actually set.
      auth:
        config.SMTP_USER !== ""
          ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
          : undefined,
    });
  }
  return transporter;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Delivery is best-effort and must never leak into the caller's response:
 * a failure here would otherwise tell the caller whether an address exists.
 * The body is never logged — it carries the sign-in token.
 */
export async function sendEmail(mail: Mail): Promise<void> {
  try {
    await getTransporter().sendMail({
      from: config.EMAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  } catch {
    // Swallowed deliberately. Subject only, never recipient or body.
    console.error(`[email] delivery failed for subject: ${mail.subject}`);
  }
}
