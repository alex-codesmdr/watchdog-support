import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { sql } from 'kysely';
import { ApiKeyCreateRequest, WebhookCreateRequest, type ApiKeyView } from '@wd/contracts';
import { z } from 'zod';
import type { Database } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { audit } from '../../common/audit.js';
import { forbidden, notFound, unprocessable } from '../../common/errors.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { hashSecret, newApiKey } from '../../common/secrets.js';
import { parse } from '../../common/zod.js';
import { WebhooksService } from './webhooks.service.js';

const uuid = z.string().uuid();

/** Customer administrators manage their organisation's API keys and webhooks. */
@Controller('api/v1/org')
export class IntegrationsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(WebhooksService) private readonly hooks: WebhooksService,
  ) {}

  /** API keys can never manage keys or webhooks, so a leaked key cannot entrench itself. */
  private human(p: Principal) {
    if (p.apiKeyId) throw forbidden('Sign in to manage API keys and webhooks');
  }

  @Get('api-keys')
  @RequirePermission('integration:manage')
  async keys(@CurrentPrincipal() p: Principal): Promise<{ items: ApiKeyView[] }> {
    this.human(p);
    return this.db.withTenant(p, async (tx) => {
      const rows = await tx
        .selectFrom('api_key as k')
        .innerJoin('app_user as u', 'u.id', 'k.created_by')
        .select([
          'k.id',
          'k.name',
          'k.prefix',
          'k.scopes',
          'k.created_at',
          'k.expires_at',
          'k.last_used_at',
          'k.revoked_at',
          'u.display_name',
        ])
        .where('k.org_id', '=', p.orgId)
        .orderBy('k.created_at', 'desc')
        .execute();
      return {
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          prefix: `wdk_${r.prefix}`,
          scopes: r.scopes as ApiKeyView['scopes'],
          createdBy: r.display_name,
          createdAt: r.created_at.toISOString(),
          expiresAt: r.expires_at?.toISOString() ?? null,
          lastUsedAt: r.last_used_at?.toISOString() ?? null,
          revokedAt: r.revoked_at?.toISOString() ?? null,
        })),
      };
    });
  }

  @Post('api-keys')
  @RequirePermission('integration:manage')
  @RateLimit('api-key-create', 20, 3600)
  async createKey(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    this.human(p);
    const b = parse(ApiKeyCreateRequest, body);
    const k = newApiKey();
    const hash = await hashSecret(k.secret);
    return this.db.withTenant(p, async (tx) => {
      const n = await tx
        .selectFrom('api_key')
        .select(sql<string>`count(*)`.as('n'))
        .where('org_id', '=', p.orgId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (Number(n?.n) >= 20)
        throw unprocessable('name', 'Revoke unused keys first (at most 20 active keys)');
      const r = await tx
        .insertInto('api_key')
        .values({
          org_id: p.orgId,
          name: b.name,
          prefix: k.prefix,
          secret_hash: hash,
          scopes: [...new Set(b.scopes)],
          created_by: p.userId,
          expires_at: new Date(Date.now() + b.expiresInDays * 86_400_000),
        })
        .returning(['id', 'expires_at'])
        .executeTakeFirstOrThrow();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'api_key.create',
          orgId: p.orgId,
          targetType: 'api_key',
          targetId: r.id,
          diff: { name: b.name, scopes: b.scopes, prefix: `wdk_${k.prefix}` },
        },
      );
      // The full key is returned exactly once; only its hash is kept.
      return { id: r.id, key: k.token, expiresAt: r.expires_at?.toISOString() ?? null };
    });
  }

  @Delete('api-keys/:id')
  @HttpCode(204)
  @RequirePermission('integration:manage')
  async revokeKey(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    this.human(p);
    await this.db.withTenant(p, async (tx) => {
      const r = await tx
        .updateTable('api_key')
        .set({ revoked_at: new Date() })
        .where('id', '=', uuid.parse(id))
        .where('org_id', '=', p.orgId)
        .where('revoked_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (!r) throw notFound('API key');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'api_key.revoke', orgId: p.orgId, targetType: 'api_key', targetId: r.id },
      );
    });
  }

  // ---- webhooks
  @Get('webhooks')
  @RequirePermission('integration:manage')
  listHooks(@CurrentPrincipal() p: Principal) {
    this.human(p);
    return this.hooks.list(p);
  }

  @Post('webhooks')
  @RequirePermission('integration:manage')
  @RateLimit('webhook-create', 20, 3600)
  createHook(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Body() body: unknown) {
    this.human(p);
    const b = parse(WebhookCreateRequest, body);
    return this.hooks.create(p, ctx, b.url, b.events);
  }

  @Post('webhooks/:id/test')
  @HttpCode(200)
  @RequirePermission('integration:manage')
  @RateLimit('webhook-test', 30, 3600)
  testHook(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    this.human(p);
    return this.hooks.test(p, uuid.parse(id));
  }

  @Post('webhooks/:id/rotate-secret')
  @HttpCode(200)
  @RequirePermission('integration:manage')
  rotate(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Param('id') id: string) {
    this.human(p);
    return this.hooks.rotate(p, ctx, uuid.parse(id));
  }

  @Post('webhooks/:id/:action')
  @HttpCode(204)
  @RequirePermission('integration:manage')
  async toggle(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('action') action: string,
  ) {
    this.human(p);
    const a = z.enum(['enable', 'disable']).parse(action);
    await this.hooks.setActive(p, ctx, uuid.parse(id), a === 'enable');
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  @RequirePermission('integration:manage')
  async removeHook(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    this.human(p);
    await this.hooks.remove(p, ctx, uuid.parse(id));
  }
}
