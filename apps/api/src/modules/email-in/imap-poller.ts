import { ImapFlow } from 'imapflow';
import type { AppConfig } from '../../config.js';
import { logger } from '../../common/logger.js';
import type { EmailInService } from './email-in.service.js';

/** Polls the support mailbox (IMAP over TLS), ingests unseen mail, then marks it seen. */
export class ImapPoller {
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(
    private readonly cfg: AppConfig,
    private readonly svc: EmailInService,
    private readonly intervalMs = 60_000,
  ) {}

  start() {
    if (!this.cfg.IMAP_HOST) {
      logger.info('IMAP not configured; inbound email polling disabled');
      return;
    }
    const tick = () =>
      void this.poll().finally(() => (this.timer = setTimeout(tick, this.intervalMs)));
    tick();
  }

  stop() {
    clearTimeout(this.timer);
  }

  async poll() {
    if (this.running) return;
    this.running = true;
    const client = new ImapFlow({
      host: this.cfg.IMAP_HOST!,
      port: this.cfg.IMAP_PORT,
      secure: this.cfg.IMAP_PORT === 993,
      auth: { user: this.cfg.IMAP_USER ?? '', pass: this.cfg.IMAP_PASSWORD ?? '' },
      logger: false,
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
          if (!msg.source) continue;
          const r = await this.svc.ingest(msg.source);
          logger.info({ uid: msg.uid, status: r.status }, 'inbound email processed');
          await client.messageFlagsAdd({ uid: String(msg.uid) }, ['\\Seen'], { uid: true });
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (err) {
      logger.error({ err }, 'IMAP poll failed');
      client.close();
    } finally {
      this.running = false;
    }
  }
}
