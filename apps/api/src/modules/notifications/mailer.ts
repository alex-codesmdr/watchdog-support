import nodemailer from 'nodemailer';
import type { AppConfig } from '../../config.js';

export interface OutboundMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
}
export interface MailTransport {
  send(m: OutboundMail): Promise<void>;
}

export class SmtpTransport implements MailTransport {
  private readonly t: nodemailer.Transporter;
  constructor(private readonly cfg: AppConfig) {
    this.t = nodemailer.createTransport({
      host: cfg.SMTP_HOST,
      port: cfg.SMTP_PORT,
      secure: cfg.SMTP_SECURE,
      auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD } : undefined,
      requireTLS: cfg.NODE_ENV === 'production',
    });
  }
  async send(m: OutboundMail): Promise<void> {
    await this.t.sendMail({
      from: this.cfg.MAIL_FROM,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      replyTo: m.replyTo,
      headers: m.headers,
    });
  }
}

/** Test/dev transport that records messages. */
export class MemoryTransport implements MailTransport {
  readonly sent: OutboundMail[] = [];
  async send(m: OutboundMail): Promise<void> {
    this.sent.push(m);
  }
}

/** SMS / WhatsApp adapter shape for an Indian DLT-registered gateway (template id + variables). */
export interface SmsAdapter {
  send(to: string, dltTemplateId: string, vars: Record<string, string>): Promise<void>;
}
export class MockSmsAdapter implements SmsAdapter {
  readonly sent: Array<{ to: string; dltTemplateId: string; vars: Record<string, string> }> = [];
  async send(to: string, dltTemplateId: string, vars: Record<string, string>): Promise<void> {
    this.sent.push({ to, dltTemplateId, vars });
  }
}
