import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { JiraLinkRequest, type JiraLink } from '@wd/contracts';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { conflict, forbidden, notFound, ProblemError } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';
import { JiraService } from './jira.service.js';

const Ref = z.string().regex(/^WD-\d{4}-\d{6}$/i);
const tracker = (e: unknown): never => {
  logger.warn({ err: e }, 'engineering tracker call failed');
  throw new ProblemError(
    502,
    'tracker',
    'The engineering tracker did not respond. Try again in a minute.',
  );
};

/** Raise or link an engineering issue from a case (L3 engineers and support managers). */
@Controller('api/v1/workspace/cases/:ref/jira')
export class JiraController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(JiraService) private readonly jira: JiraService,
  ) {}

  private staff(p: Principal) {
    if (!p.isInternal || p.apiKeyId) throw forbidden();
  }
  private async caseId(tx: Tx, ref: string) {
    const c = await tx
      .selectFrom('support_case')
      .select(['id', 'org_id'])
      .where('number', '=', parse(Ref, ref).toUpperCase())
      .executeTakeFirst();
    if (!c) throw notFound('Case');
    return c;
  }
  private async link(tx: Tx, caseId: string) {
    return tx
      .selectFrom('case_jira_link')
      .selectAll()
      .where('case_id', '=', caseId)
      .executeTakeFirst();
  }

  @Get()
  @RequirePermission('case:read:all')
  show(
    @CurrentPrincipal() p: Principal,
    @Param('ref') ref: string,
  ): Promise<{ link: JiraLink | null }> {
    this.staff(p);
    return this.db.withTenant(p, async (tx) => {
      const l = await this.link(tx, (await this.caseId(tx, ref)).id);
      return { link: l ? this.jira.view(l) : null };
    });
  }

  @Post()
  @RequirePermission('jira:link')
  @RateLimit('jira-link', 30, 3600)
  async create(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ): Promise<{ link: JiraLink }> {
    this.staff(p);
    const b = parse(JiraLinkRequest, body);
    // Build the issue inside the tenant, call the tracker outside the transaction, then record it.
    const { c, issue } = await this.db.withTenant(p, async (tx) => {
      const c = await this.caseId(tx, ref);
      if (await this.link(tx, c.id))
        throw conflict('linked', 'This case already has an engineering issue');
      const d = await this.jira.describe(tx, c.id, b.notes);
      return { c, issue: { ...d, summary: b.summary ?? d.summary } };
    });
    const made = b.existingKey
      ? ((await this.jira.get(b.existingKey).catch(tracker)) ??
        (() => {
          throw new ProblemError(
            404,
            'not_found',
            `${b.existingKey} was not found in the engineering tracker`,
          );
        })())
      : await this.jira.create(issue).catch(tracker);
    return this.db.withTenant(p, async (tx) => {
      const row = await tx
        .insertInto('case_jira_link')
        .values({
          case_id: c.id,
          issue_key: made.key,
          issue_url: made.url,
          status: made.status,
          category: made.category,
          linked_by: p.userId,
        } as never)
        .onConflict((oc) => oc.column('case_id').doNothing())
        .returningAll()
        .executeTakeFirst();
      if (!row) throw conflict('linked', 'This case already has an engineering issue');
      await tx
        .insertInto('case_event')
        .values({
          case_id: c.id,
          type: 'jira_linked',
          visibility: 'internal',
          actor_id: p.userId,
          data: JSON.stringify({ key: made.key, existing: Boolean(b.existingKey) }),
        } as never)
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'case.jira_link',
          orgId: c.org_id,
          targetType: 'case',
          targetId: c.id,
          diff: { key: made.key },
        },
      );
      return { link: this.jira.view(row) };
    });
  }

  /** Fetches the latest status now instead of waiting for the next sync. */
  @Post('refresh')
  @HttpCode(200)
  @RequirePermission('case:read:all')
  @RateLimit('jira-refresh', 60, 600)
  async refresh(
    @CurrentPrincipal() p: Principal,
    @Param('ref') ref: string,
  ): Promise<{ link: JiraLink | null }> {
    this.staff(p);
    const l = await this.db.withTenant(p, async (tx) =>
      this.link(tx, (await this.caseId(tx, ref)).id),
    );
    if (!l) return { link: null };
    const now = await this.jira.get(l.issue_key).catch(tracker);
    return this.db.withTenant(p, async (tx) => {
      if (now) await this.jira.apply(tx, l.case_id, l, now);
      const fresh = await this.link(tx, l.case_id);
      return { link: fresh ? this.jira.view(fresh) : null };
    });
  }
}
