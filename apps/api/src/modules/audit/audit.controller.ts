import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sql, type SqlBool } from 'kysely';
import { AuditQuery, type AuditEntry, type AuditPage } from '@wd/contracts';
import type { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { forbidden } from '../../common/errors.js';
import { has, type Principal } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';

const PAGE = 100;
type Q = z.infer<typeof AuditQuery>;

/**
 * The hash-chained audit trail (threat T11). Staff with `audit:read:all` see everything with full
 * detail; customer administrators see their own organisation's entries, with WatchDog staff shown
 * as "WatchDog Support" and staff-side detail (change data, addresses) withheld.
 */
@Controller('api/v1/audit-log')
export class AuditController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private staff(p: Principal) {
    if (has(p, 'audit:read:all')) return true;
    if (has(p, 'audit:read:org') && !p.isInternal && !p.apiKeyId) return false;
    throw forbidden();
  }

  private async query(tx: Tx, p: Principal, q: Q, limit: number): Promise<AuditEntry[]> {
    const full = this.staff(p);
    let s = tx
      .selectFrom('audit_log as l')
      .leftJoin('organization as o', 'o.id', 'l.org_id')
      .leftJoin('app_user as u', 'u.id', 'l.actor_id')
      .select([
        'l.seq',
        'l.at',
        'o.name as org_name',
        'l.actor_id',
        'u.display_name',
        'u.email',
        'l.action',
        'l.target_type',
        'l.target_id',
        'l.diff',
        sql<string | null>`host(l.ip)`.as('ip'),
      ])
      .orderBy('l.seq', 'desc')
      .limit(limit);
    if (!full) s = s.where('l.org_id', '=', p.orgId);
    else if (q.orgId) s = s.where('l.org_id', '=', q.orgId);
    if (q.before) s = s.where('l.seq', '<', String(q.before));
    if (q.from)
      s = s.where(sql<SqlBool>`(l.at AT TIME ZONE 'Asia/Kolkata')::date >= ${q.from}::date`);
    if (q.to) s = s.where(sql<SqlBool>`(l.at AT TIME ZONE 'Asia/Kolkata')::date <= ${q.to}::date`);
    if (q.action)
      s = s.where('l.action', 'like', `${q.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    if (q.targetType) s = s.where('l.target_type', '=', q.targetType);
    if (q.actor) {
      const like = `%${q.actor.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      s = s.where((eb) =>
        eb.or([eb('u.email', 'ilike', like), eb('u.display_name', 'ilike', like)]),
      );
    }
    const rows = await s.execute();
    const ids = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
    const staffIds = new Set(
      ids.length
        ? (
            await sql<{
              id: string;
              is_staff: boolean;
            }>`SELECT id, is_staff FROM wd.display_names(${ids}::uuid[])`.execute(tx)
          ).rows
            .filter((r) => r.is_staff)
            .map((r) => r.id)
        : [],
    );
    return rows.map((r) => {
      const byStaff = !!r.actor_id && staffIds.has(r.actor_id);
      const hideDetail = !full && (byStaff || !r.actor_id);
      return {
        seq: Number(r.seq),
        at: r.at.toISOString(),
        orgName: r.org_name,
        actor: !r.actor_id
          ? 'System'
          : byStaff && !full
            ? 'WatchDog Support'
            : (r.display_name ?? 'Unknown user'),
        actorEmail: full ? (r.email ?? null) : null,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        diff: hideDetail ? null : ((r.diff as Record<string, unknown>) ?? null),
        ip: hideDetail ? null : r.ip,
      };
    });
  }

  @Get()
  @RequirePermission('audit:read:org', 'audit:read:all')
  async list(@CurrentPrincipal() p: Principal, @Query() query: unknown): Promise<AuditPage> {
    const q = parse(AuditQuery, query);
    const items = await this.db.withTenant(p, (tx) => this.query(tx, p, q, PAGE + 1));
    const page = items.slice(0, PAGE);
    return { items: page, nextBefore: items.length > PAGE ? page[page.length - 1]!.seq : null };
  }

  /** Recomputes the whole hash chain. Staff only; it reads every entry. */
  @Get('verify')
  @RequirePermission('audit:read:all')
  @RateLimit('audit-verify', 10, 3600)
  async verify(@CurrentPrincipal() p: Principal) {
    const started = Date.now();
    return this.db.withTenant(p, async (tx) => {
      const bad = await sql<{ seq: string | null }>`SELECT wd.audit_verify() AS seq`.execute(tx);
      const n = await tx
        .selectFrom('audit_log')
        .select(sql<string>`count(*)`.as('n'))
        .executeTakeFirst();
      const firstBadSeq = bad.rows[0]?.seq ?? null;
      return {
        intact: firstBadSeq === null,
        firstBadSeq: firstBadSeq === null ? null : Number(firstBadSeq),
        entries: Number(n?.n ?? 0),
        checkedAt: new Date().toISOString(),
        tookMs: Date.now() - started,
      };
    });
  }

  @Get('export.csv')
  @RequirePermission('audit:read:org', 'audit:read:all')
  @RateLimit('audit-csv', 20, 3600)
  async csv(@CurrentPrincipal() p: Principal, @Query() query: unknown, @Res() res: Response) {
    const q = parse(AuditQuery, query);
    const items = await this.db.withTenant(p, (tx) => this.query(tx, p, q, 20_000));
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const head = [
      'Sequence',
      'Time (UTC)',
      'Organisation',
      'By',
      'Email',
      'Action',
      'Target type',
      'Target',
      'Detail',
      'IP',
    ];
    const lines = items.map((e) =>
      [
        e.seq,
        e.at,
        e.orgName,
        e.actor,
        e.actorEmail,
        e.action,
        e.targetType,
        e.targetId,
        e.diff,
        e.ip,
      ]
        .map(cell)
        .join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="watchdog-audit-log.csv"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(`\uFEFF${[head.join(','), ...lines].join('\r\n')}\r\n`);
  }
}
