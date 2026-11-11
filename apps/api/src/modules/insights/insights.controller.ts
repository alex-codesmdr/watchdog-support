import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  LowRatingFollowUp,
  type CallerOrg,
  type CallerOrgDetail,
  type CaseSuggestions,
  type LowRating,
  type ManagementDashboard,
} from '@wd/contracts';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { conflict, forbidden, notFound } from '../../common/errors.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { htmlToText } from '../../common/sanitize.js';
import { parse } from '../../common/zod.js';
import { keywords } from '../assistant/assistant.service.js';
import { audienceFor } from '../kb/kb.service.js';
import { monthsBack, slaPct } from './stats.js';

const Id = z.string().uuid();
const Ref = z.string().regex(/^WD-\d{4}-\d{6}$/i);
const ENGINEER_ROLES = ['l1_engineer', 'l2_engineer', 'l3_engineer', 'support_manager'];
const num = (v: unknown) => Number(v ?? 0);
const avg = (v: unknown) =>
  v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10;

/**
 * Staff insight tools: the management dashboard, call-backs for low satisfaction ratings, article
 * and similar-case suggestions beside a case, and the look-ups behind logging a phone call.
 */
@Controller('api/v1/workspace')
export class InsightsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private staff(p: Principal) {
    if (!p.isInternal || p.apiKeyId) throw forbidden();
  }

  // ------------------------------------------------------------------ management dashboard
  @Get('dashboard')
  @RequirePermission('report:ops:read:all')
  dashboard(@CurrentPrincipal() p: Principal): Promise<ManagementDashboard> {
    this.staff(p);
    const months = monthsBack(new Date(), 6);
    const first = months[0]!;
    const thisMonth = months[months.length - 1]!;
    return this.db.withTenant(p, async (tx) => {
      const opened = await sql<{ m: string; n: string }>`
        SELECT to_char(date_trunc('month', opened_at), 'YYYY-MM-01') AS m, count(*) AS n
          FROM support_case WHERE opened_at >= ${first}::date AND merged_into_id IS NULL
         GROUP BY 1`.execute(tx);
      const resolved = await sql<{ m: string; n: string }>`
        SELECT to_char(date_trunc('month', resolved_at), 'YYYY-MM-01') AS m, count(*) AS n
          FROM support_case WHERE resolved_at >= ${first}::date AND merged_into_id IS NULL
         GROUP BY 1`.execute(tx);
      const sla = await sql<{ m: string; met: string; breached: string }>`
        SELECT to_char(date_trunc('month', c.opened_at), 'YYYY-MM-01') AS m,
               count(*) FILTER (WHERE k.met_at IS NOT NULL AND k.breached_at IS NULL) AS met,
               count(*) FILTER (WHERE k.breached_at IS NOT NULL) AS breached
          FROM sla_clock k JOIN support_case c ON c.id = k.case_id
         WHERE c.opened_at >= ${first}::date
         GROUP BY 1`.execute(tx);
      const csat = await sql<{ m: string; a: string | null; n: string }>`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM-01') AS m, avg(score) AS a, count(*) AS n
          FROM csat_response WHERE created_at >= ${first}::date
         GROUP BY 1`.execute(tx);
      const at = <T extends { m: string }>(rows: T[], m: string) => rows.find((r) => r.m === m);

      const now = await sql<{
        open: string;
        p1: string;
        unassigned: string;
        breached: string;
        low: string;
      }>`
        SELECT count(*) FILTER (WHERE c.status NOT IN ('resolved', 'closed')) AS open,
               count(*) FILTER (WHERE c.status NOT IN ('resolved', 'closed') AND c.severity = 'P1') AS p1,
               count(*) FILTER (WHERE c.status NOT IN ('resolved', 'closed') AND c.assignee_id IS NULL) AS unassigned,
               count(*) FILTER (WHERE c.status NOT IN ('resolved', 'closed') AND EXISTS (
                 SELECT 1 FROM sla_clock k WHERE k.case_id = c.id AND k.breached_at IS NOT NULL AND k.met_at IS NULL)) AS breached,
               (SELECT count(*) FROM csat_response WHERE followup_status = 'needed') AS low
          FROM support_case c WHERE c.merged_into_id IS NULL`.execute(tx);
      const n = now.rows[0]!;

      const byFamily = await sql<{ key: string | null; name: string | null; n: string }>`
        SELECT f.key, f.name, count(*) AS n
          FROM support_case c
          LEFT JOIN asset a ON a.id = c.asset_id
          LEFT JOIN product pr ON pr.id = a.product_id
          LEFT JOIN product_family f ON f.id = pr.family_id
         WHERE c.opened_at >= now() - interval '90 days' AND c.merged_into_id IS NULL
         GROUP BY f.key, f.name ORDER BY n DESC`.execute(tx);
      const top = await sql<{ id: string; name: string; n: string }>`
        SELECT o.id, o.name, count(*) AS n
          FROM support_case c JOIN organization o ON o.id = c.org_id
         WHERE c.opened_at >= now() - interval '90 days' AND c.merged_into_id IS NULL
         GROUP BY o.id, o.name ORDER BY n DESC, o.name LIMIT 8`.execute(tx);
      const eng = await sql<{
        id: string;
        name: string;
        open: string;
        done: string;
        csat: string | null;
      }>`
        SELECT u.id, u.display_name AS name,
               (SELECT count(*) FROM support_case c WHERE c.assignee_id = u.id
                  AND c.status NOT IN ('resolved', 'closed')) AS open,
               (SELECT count(*) FROM support_case c WHERE c.assignee_id = u.id
                  AND c.resolved_at >= ${thisMonth}::date) AS done,
               (SELECT avg(r.score) FROM csat_response r JOIN support_case c ON c.id = r.case_id
                 WHERE c.assignee_id = u.id AND r.created_at >= now() - interval '90 days') AS csat
          FROM app_user u
         WHERE u.status = 'active'
           AND EXISTS (SELECT 1 FROM user_role ur WHERE ur.user_id = u.id
                        AND ur.role_key = ANY(${ENGINEER_ROLES}::text[]))
         ORDER BY open DESC, u.display_name`.execute(tx);

      return {
        months: months.map((m) => {
          const s = at(sla.rows, m);
          const c = at(csat.rows, m);
          return {
            month: m,
            opened: num(at(opened.rows, m)?.n),
            resolved: num(at(resolved.rows, m)?.n),
            slaMetPct: s ? slaPct(num(s.met), num(s.breached)) : null,
            csatAverage: c ? avg(c.a) : null,
            csatResponses: num(c?.n),
          };
        }),
        now: {
          openCases: num(n.open),
          openP1: num(n.p1),
          unassigned: num(n.unassigned),
          breachedOpen: num(n.breached),
          lowRatingsWaiting: num(n.low),
        },
        byFamily: byFamily.rows.map((r) => ({
          key: r.key ?? 'unknown',
          label: r.name ?? 'Not linked to a device',
          count: num(r.n),
        })),
        topCustomers: top.rows.map((r) => ({ key: r.id, label: r.name, count: num(r.n) })),
        engineers: eng.rows.map((r) => ({
          id: r.id,
          name: r.name,
          open: num(r.open),
          resolvedThisMonth: num(r.done),
          csatAverage: avg(r.csat),
        })),
      };
    });
  }

  // ------------------------------------------------------------------ low ratings
  @Get('low-ratings')
  @RequirePermission('csat:followup')
  async lowRatings(
    @CurrentPrincipal() p: Principal,
    @Query('show') show?: string,
  ): Promise<{ items: LowRating[] }> {
    this.staff(p);
    const all = show === 'all';
    const rows = await this.db.withTenant(p, (tx) => {
      let q = tx
        .selectFrom('csat_response as r')
        .innerJoin('support_case as c', 'c.id', 'r.case_id')
        .innerJoin('organization as o', 'o.id', 'c.org_id')
        .innerJoin('app_user as u', 'u.id', 'r.user_id')
        .leftJoin('app_user as f', 'f.id', 'r.followup_by')
        .select([
          'r.id',
          'c.number',
          'c.subject',
          'o.name as org_name',
          'u.display_name',
          'u.email',
          'u.phone',
          'r.score',
          'r.comment',
          'r.created_at',
          'r.followup_status',
          'f.display_name as followed_by',
          'r.followup_at',
          'r.followup_note',
        ])
        .where('r.followup_status', 'is not', null);
      if (!all) q = q.where('r.followup_status', '=', 'needed');
      return q.orderBy('r.created_at', 'desc').limit(100).execute();
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        caseNumber: r.number,
        subject: r.subject,
        orgName: r.org_name,
        contactName: r.display_name,
        contactEmail: r.email,
        contactPhone: r.phone,
        score: r.score,
        comment: r.comment,
        ratedAt: r.created_at.toISOString(),
        status: r.followup_status as 'needed' | 'done',
        followedUpBy: r.followed_by,
        followedUpAt: r.followup_at?.toISOString() ?? null,
        note: r.followup_note,
      })),
    };
  }

  @Post('low-ratings/:id')
  @RequirePermission('csat:followup')
  async followUp(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    this.staff(p);
    const id = parse(Id, raw);
    const { note } = parse(LowRatingFollowUp, body);
    await this.db.withTenant(p, async (tx) => {
      const r = await tx
        .selectFrom('csat_response')
        .select(['id', 'case_id', 'org_id', 'followup_status'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!r || !r.followup_status) throw notFound('Rating');
      if (r.followup_status === 'done')
        throw conflict('already-done', 'Someone has already called this customer back');
      await tx
        .updateTable('csat_response')
        .set({
          followup_status: 'done',
          followup_by: p.userId,
          followup_at: new Date(),
          followup_note: note,
        })
        .where('id', '=', id)
        .execute();
      await tx
        .insertInto('case_event')
        .values({
          case_id: r.case_id,
          type: 'csat_followed_up',
          actor_id: p.userId,
          visibility: 'internal',
          data: { note },
        })
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'csat.followup',
          orgId: r.org_id,
          targetType: 'case',
          targetId: r.case_id,
          diff: {},
        },
      );
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ suggestions beside a case
  @Get('cases/:ref/suggestions')
  @RequirePermission('case:read:all')
  suggestions(
    @CurrentPrincipal() p: Principal,
    @Param('ref') raw: string,
  ): Promise<CaseSuggestions> {
    this.staff(p);
    const ref = parse(Ref, raw).toUpperCase();
    return this.db.withTenant(p, async (tx) => {
      const c = await tx
        .selectFrom('support_case')
        .select(['id', 'subject', 'description_html', 'category'])
        .where('number', '=', ref)
        .executeTakeFirst();
      if (!c) throw notFound('Case');
      // The subject counts most; the first part of the description adds context.
      const words = [
        ...new Set([
          ...keywords(c.subject),
          ...keywords(htmlToText(c.description_html).slice(0, 400)),
        ]),
      ].slice(0, 12);
      if (!words.length) return { articles: [], cases: [] };
      const tsq = words.join(' | ');
      const subj = keywords(c.subject).join(' | ') || tsq;
      const articles = await sql<{ slug: string; title: string; type: string }>`
        SELECT a.slug, a.title, a.type
          FROM kb_article a
         WHERE a.state = 'published' AND a.visibility = ANY(${audienceFor(p)}::text[])
           AND (a.search_vec @@ to_tsquery('english', ${tsq}) OR a.search_vec @@ to_tsquery('simple', ${tsq}))
         ORDER BY ts_rank_cd(a.search_vec, to_tsquery('english', ${subj}), 32) * 3
                + ts_rank_cd(a.search_vec, to_tsquery('english', ${tsq}), 32) DESC,
                  a.helpful - a.not_helpful DESC
         LIMIT 5`.execute(tx);
      const similar = await sql<{
        id: string;
        number: string;
        subject: string;
        org_name: string;
        resolved_at: Date | null;
      }>`
        SELECT s.id, s.number, s.subject, o.name AS org_name, s.resolved_at
          FROM support_case s JOIN organization o ON o.id = s.org_id
         WHERE s.id <> ${c.id} AND s.status IN ('resolved', 'closed') AND s.merged_into_id IS NULL
           AND (to_tsvector('english', s.subject) @@ to_tsquery('english', ${subj})
                OR similarity(s.subject, ${c.subject}) > 0.3)
         ORDER BY (s.category = ${c.category}) DESC,
                  similarity(s.subject, ${c.subject})
                + ts_rank_cd(to_tsvector('english', s.subject), to_tsquery('english', ${subj})) DESC,
                  s.resolved_at DESC NULLS LAST
         LIMIT 5`.execute(tx);
      const fixes = similar.rows.length
        ? await tx
            .selectFrom('case_message')
            .select(['case_id', 'body_html', 'created_at'])
            .where(
              'case_id',
              'in',
              similar.rows.map((r) => r.id),
            )
            .where('author_is_staff', '=', true)
            .where('visibility', '=', 'public')
            .orderBy('created_at', 'desc')
            .execute()
        : [];
      const clip = (t: string) => (t.length > 280 ? `${t.slice(0, t.lastIndexOf(' ', 280))}…` : t);
      return {
        articles: articles.rows,
        cases: similar.rows.map((r) => {
          const last = fixes.find((f) => f.case_id === r.id);
          return {
            number: r.number,
            subject: r.subject,
            orgName: r.org_name,
            resolvedAt: r.resolved_at?.toISOString() ?? null,
            resolution: last ? clip(htmlToText(last.body_html).replace(/\s+/g, ' ').trim()) : '',
          };
        }),
      };
    });
  }

  // ------------------------------------------------------------------ phone call logging look-ups
  @Get('callers')
  @RequirePermission('case:create:on_behalf')
  async callers(
    @CurrentPrincipal() p: Principal,
    @Query('q') raw?: string,
  ): Promise<{ items: CallerOrg[] }> {
    this.staff(p);
    const q = z
      .string()
      .trim()
      .max(80)
      .parse(raw ?? '');
    if (q.length < 2) return { items: [] };
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const rows = await this.db.withTenant(p, (tx) =>
      sql<{ id: string; name: string }>`
        SELECT DISTINCT o.id, o.name
          FROM organization o
          LEFT JOIN app_user u ON u.org_id = o.id AND u.status <> 'disabled'
          LEFT JOIN asset a ON a.org_id = o.id
         WHERE o.org_type <> 'internal' AND o.status = 'active'
           AND (o.name ILIKE ${like} OR u.phone ILIKE ${like} OR u.email ILIKE ${like}
                OR u.display_name ILIKE ${like} OR a.serial_number ILIKE ${like})
         ORDER BY o.name LIMIT 10`.execute(tx),
    );
    return { items: rows.rows };
  }

  @Get('callers/:id')
  @RequirePermission('case:create:on_behalf')
  caller(@CurrentPrincipal() p: Principal, @Param('id') raw: string): Promise<CallerOrgDetail> {
    this.staff(p);
    const id = parse(Id, raw);
    return this.db.withTenant(p, async (tx) => {
      const o = await tx
        .selectFrom('organization')
        .select(['id', 'name'])
        .where('id', '=', id)
        .where('org_type', '!=', 'internal')
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (!o) throw notFound('Organisation');
      const [contacts, devices] = await Promise.all([
        tx
          .selectFrom('app_user')
          .select(['id', 'display_name', 'email', 'phone'])
          .where('org_id', '=', id)
          .where('status', '!=', 'disabled')
          .orderBy('display_name')
          .execute(),
        sql<{
          serial_number: string;
          model_name: string;
          site: string | null;
          until: string | null;
        }>`
          SELECT a.serial_number, pr.model_name, s.name AS site,
                 to_char(max(e.ends_on) FILTER (WHERE e.ends_on >= current_date), 'YYYY-MM-DD') AS until
            FROM asset a
            JOIN product pr ON pr.id = a.product_id
            LEFT JOIN site s ON s.id = a.site_id
            LEFT JOIN entitlement e ON e.asset_id = a.id
           WHERE a.org_id = ${id}
           GROUP BY a.id, a.serial_number, pr.model_name, s.name
           ORDER BY s.name NULLS LAST, pr.model_name, a.serial_number
           LIMIT 500`.execute(tx),
      ]);
      return {
        id: o.id,
        name: o.name,
        contacts: contacts.map((c) => ({
          id: c.id,
          name: c.display_name,
          email: c.email,
          phone: c.phone,
        })),
        devices: devices.rows.map((d) => ({
          serialNumber: d.serial_number,
          modelName: d.model_name,
          siteName: d.site,
          coveredUntil: d.until,
        })),
      };
    });
  }
}
