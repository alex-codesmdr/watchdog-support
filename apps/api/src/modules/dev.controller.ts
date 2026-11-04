import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/auth.js';
import { notFound } from '../common/errors.js';
import type { AppConfig } from '../config.js';
import { CONFIG } from '../tokens.js';
import { EmailInService } from './email-in/email-in.service.js';

/**
 * Local-development helpers. Every route 404s unless NODE_ENV=development.
 * POST raw RFC 822 text to simulate the IMAP mailbox (Mailpit has no IMAP).
 */
@Controller('api/v1/dev')
export class DevController {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(EmailInService) private readonly mail: EmailInService,
  ) {}

  @Public()
  @Post('inbound-email')
  @HttpCode(200)
  async inbound(@Req() req: Request, @Body() body: unknown) {
    if (this.cfg.NODE_ENV !== 'development') throw notFound();
    const raw = typeof body === 'string' ? body : (req as Request & { rawBody?: Buffer }).rawBody;
    return this.mail.ingest(raw ?? '');
  }
}
