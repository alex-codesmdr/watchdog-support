import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { PortalSettings, type PortalSettings as Settings } from '@wd/contracts';
import { sql } from 'kysely';
import type { Database } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { Ctx, CurrentPrincipal, Public, RequirePermission } from '../../common/auth.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';
import { SettingsService } from './settings.service.js';

@Controller('api/v1')
export class SettingsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Contact details and switches the website shows. Everything here is public by design. */
  @Public()
  @Get('public/settings')
  @RateLimit('public-settings', 600, 60)
  read(): Promise<Settings> {
    return this.settings.get();
  }

  @Get('admin/settings')
  @RequirePermission('settings:manage')
  admin(): Promise<Settings> {
    return this.settings.get();
  }

  @Put('admin/settings')
  @RequirePermission('settings:manage')
  async update(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<Settings> {
    const next = parse(PortalSettings, body);
    const before = await this.settings.get();
    const changed = (Object.keys(next) as (keyof Settings)[]).filter(
      (k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]),
    );
    if (changed.length)
      await this.db.withTenant(p, async (tx) => {
        for (const k of changed)
          await tx
            .insertInto('portal_setting')
            .values({ key: k, value: JSON.stringify(next[k]), updated_by: p.userId })
            .onConflict((oc) =>
              oc.column('key').doUpdateSet({
                value: JSON.stringify(next[k]),
                updated_by: p.userId,
                updated_at: sql`now()`,
              }),
            )
            .execute();
        await audit(
          tx,
          { ...ctx, actorId: p.userId },
          {
            action: 'settings.update',
            orgId: null,
            targetType: 'settings',
            diff: Object.fromEntries(changed.map((k) => [k, [before[k], next[k]]])),
          },
        );
      });
    this.settings.forget();
    return this.settings.get();
  }
}
