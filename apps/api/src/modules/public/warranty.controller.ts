import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { sql } from 'kysely';
import type { Redis } from 'ioredis';
import { WarrantyLookupRequest, type WarrantyLookupResponse } from '@wd/contracts';
import type { z } from 'zod';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/database.js';
import { CONFIG, DB, REDIS } from '../../tokens.js';
import { Public } from '../../common/auth.js';
import { ProblemError } from '../../common/errors.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';
import { Captcha } from './captcha.js';

/**
 * Public warranty check (acceptance criterion 4). Returns coverage only: model, contract kind,
 * tier, end date. Never the owning organisation, site, contract number or anything that identifies
 * a customer. Rate-limited per client IP and protected by a single-use proof-of-work challenge.
 */
@Controller('api/v1/public')
export class WarrantyController {
  private readonly captcha: Captcha;
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) cfg: AppConfig,
    @Inject(REDIS) redis: Redis | null,
  ) {
    this.captcha = new Captcha(`captcha:${cfg.APP_SIGNING_KEY}`, redis);
  }

  @Public()
  @Get('challenge')
  @RateLimit('captcha-challenge', 60, 600)
  challenge() {
    return this.captcha.challenge();
  }

  @Public()
  @Post('warranty-lookup')
  @HttpCode(200)
  @RateLimit('warranty-lookup', 20, 3600)
  async lookup(@Body() body: unknown): Promise<z.infer<typeof WarrantyLookupResponse>> {
    const b = parse(WarrantyLookupRequest, body);
    if (!(await this.captcha.verify(b.captchaToken)))
      throw new ProblemError(400, 'captcha', 'Verification failed. Reload the page and try again.');
    const serial = b.serialNumber.toUpperCase().replace(/\s+/g, '');
    const rows = await this.db.withAnonymous(
      async (tx) =>
        (
          await sql<{
            model_name: string;
            kind: string | null;
            tier: string | null;
            ends_on: string | null;
            active: boolean | null;
          }>`
            SELECT model_name, kind, tier, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, active FROM wd.warranty_lookup(${serial})`.execute(
            tx,
          )
        ).rows,
    );
    if (!rows.length) return { found: false, modelName: null, coverage: [] };
    return {
      found: true,
      modelName: rows[0]!.model_name,
      coverage: rows
        .filter((r) => r.kind && r.tier && r.ends_on)
        .map((r) => ({
          kind: r.kind!,
          tier: r.tier as 'standard' | 'premium' | 'mission_critical',
          endsOn: r.ends_on!,
          active: !!r.active,
        })),
    };
  }
}
