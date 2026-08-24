import nodemailer from "nodemailer";
import { env } from "../config/env";

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
});

export interface SendMailInput {
  toEmail: string;
  toName?: string | null;
  subject: string;
  text: string;
  html: string;
}

export async function sendMail(input: SendMailInput): Promise<{ messageId: string }> {
  const info = await transporter.sendMail({
    from: `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM_EMAIL}>`,
    to: input.toName ? `"${input.toName}" <${input.toEmail}>` : input.toEmail,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  return { messageId: info.messageId };
}
