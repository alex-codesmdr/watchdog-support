import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AnnouncementRequest, type Announcement, type AnnouncementAdmin } from '@wd/contracts';
import { sql, type Selectable } from 'kysely';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import type { AnnouncementT } from '../../db/schema.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { Ctx, CurrentPrincipal, Public, RequirePermission } from '../../common/auth.js';
import { assertBrandClean } from '../../common/brand-guard.js';
import { notFound, unprocessable } from '../../common/errors.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';

type Row = Selectable<AnnouncementT>;
const Id = z.string().uuid();
const MAX_LIVE = 3;

const view = (r: Row): Announcement => ({
  id: r.id,
  title: r.title,
  body: r.body,
  linkUrl: r.link_url,
  tone: r.tone,
  dismissible: r.tone !== 'incident',
});

/**
 * Banners across the top of the portal: maintenance windows, incidents, notices. Anyone may read
 * the live ones meant for them; support managers, content editors and system administrators
 * write them. Incidents cannot be dismissed while they last.
 */
@Controller('api/v1')
export class AnnouncementsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Public()
  @Get('announcements')
  @RateLimit('announcements', 240, 60)
  async live(@Req() req: Request): Promise<{ items: Announcement[] }> {
    const p = req.wd?.principal;
    const run = (tx: Tx) => {
      let q = tx
        .selectFrom('announcement')
        .selectAll()
        .where('starts_at', '<=', sql<Date>`now()`)
        .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', sql<Date>`now()`)]));
      // Staff see what everyone sees plus staff notices; customers see customer notices too.
      q = q.where(
        'audience',
        'in',
        !p ? ['everyone'] : p.isInternal ? ['everyone', 'staff'] : ['everyone', 'customers'],
      );
      return q
        .orderBy(sql`CASE tone WHEN 'incident' THEN 0 WHEN 'maintenance' THEN 1 ELSE 2 END`)
        .orderBy('starts_at', 'desc')
        .limit(MAX_LIVE)
        .execute();
    };
    const rows = await (p ? this.db.withTenant(p, run) : this.db.withAnonymous(run));
    return { items: rows.map(view) };
  }

  @Get('admin/announcements')
  @RequirePermission('announcement:manage')
  async list(@CurrentPrincipal() p: Principal): Promise<{ items: AnnouncementAdmin[] }> {
    return this.db.withTenant(p, async (tx) => {
      const rows = await tx
        .selectFrom('announcement as a')
        .innerJoin('app_user as u', 'u.id', 'a.created_by')
        .selectAll('a')
        .select('u.display_name')
        .orderBy('a.starts_at', 'desc')
        .limit(200)
        .execute();
      return { items: rows.map((r) => this.admin(r, r.display_name)) };
    });
  }

  private admin(r: Row, by: string | null): AnnouncementAdmin {
    const now = Date.now();
    const state =
      r.starts_at.getTime() > now
        ? 'scheduled'
        : r.ends_at && r.ends_at.getTime() <= now
          ? 'ended'
          : 'live';
    return {
      ...view(r),
      audience: r.audience,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at?.toISOString() ?? null,
      state,
      createdBy: by ?? 'Unknown user',
      updatedAt: r.updated_at.toISOString(),
    };
  }

  private values(body: unknown, existingStart?: Date) {
    const a = parse(AnnouncementRequest, body);
    assertBrandClean({ title: a.title, body: a.body });
    const start = a.startsAt ? new Date(a.startsAt) : (existingStart ?? new Date());
    if (a.endsAt && new Date(a.endsAt) <= start)
      throw unprocessable('announcement_window', 'The end must be after the start');
    if (a.endsAt && new Date(a.endsAt) <= new Date())
      throw unprocessable('announcement_window', 'The end time has already passed');
    return {
      title: a.title,
      body: a.body,
      link_url: a.linkUrl,
      tone: a.tone,
      audience: a.audience,
      ...(a.startsAt ? { starts_at: a.startsAt } : {}),
      ends_at: a.endsAt,
    };
  }

  private async one(tx: Tx, id: string) {
    const r = await tx
      .selectFrom('announcement as a')
      .innerJoin('app_user as u', 'u.id', 'a.created_by')
      .selectAll('a')
      .select('u.display_name')
      .where('a.id', '=', id)
      .executeTakeFirst();
    if (!r) throw notFound('Announcement');
    return this.admin(r, r.display_name);
  }

  @Post('admin/announcements')
  @RequirePermission('announcement:manage')
  create(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Body() body: unknown) {
    const v = this.values(body);
    return this.db.withTenant(p, async (tx) => {
      const { id } = await tx
        .insertInto('announcement')
        .values({ ...v, created_by: p.userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'announcement.create',
          orgId: null,
          targetType: 'announcement',
          targetId: id,
          diff: { title: v.title, tone: v.tone, audience: v.audience },
        },
      );
      return this.one(tx, id);
    });
  }

  @Put('admin/announcements/:id')
  @RequirePermission('announcement:manage')
  update(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(Id, raw);
    return this.db.withTenant(p, async (tx) => {
      const cur = await tx
        .selectFrom('announcement')
        .select('starts_at')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!cur) throw notFound('Announcement');
      const v = this.values(body, cur.starts_at);
      const r = await tx
        .updateTable('announcement')
        .set(v)
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      if (!r) throw notFound('Announcement');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'announcement.update',
          orgId: null,
          targetType: 'announcement',
          targetId: id,
          diff: { title: v.title, tone: v.tone, audience: v.audience },
        },
      );
      return this.one(tx, id);
    });
  }

  /** Takes a banner down now (kept for the record rather than deleted). */
  @Post('admin/announcements/:id/end')
  @HttpCode(200)
  @RequirePermission('announcement:manage')
  end(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Param('id') raw: string) {
    const id = parse(Id, raw);
    return this.db.withTenant(p, async (tx) => {
      const r = await tx
        .updateTable('announcement')
        .set({
          // A scheduled banner that is ended never goes live.
          starts_at: sql<Date>`least(starts_at, now() - interval '1 second')`,
          ends_at: sql<Date>`now()`,
        })
        .where('id', '=', id)
        .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', sql<Date>`now()`)]))
        .returning('id')
        .executeTakeFirst();
      if (r)
        await audit(
          tx,
          { ...ctx, actorId: p.userId },
          { action: 'announcement.end', orgId: null, targetType: 'announcement', targetId: id },
        );
      return this.one(tx, id);
    });
  }
}
