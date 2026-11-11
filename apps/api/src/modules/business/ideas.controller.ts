import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { IdeaCreate, IdeaStaffUpdate, IdeaStatus, type IdeaView } from '@wd/contracts';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { assertBrandClean } from '../../common/brand-guard.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { forbidden, notFound, unprocessable } from '../../common/errors.js';
import { has, type Principal, type RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';

const Id = z.string().uuid();
const Sort = z.enum(['top', 'new']).default('top');

/**
 * Feature request board. Customers and partners suggest improvements and vote; everyone signed in
 * sees every suggestion, but never who posted it (staff do). Staff set the status, respond and can
 * hide anything unsuitable.
 */
@Controller('api/v1/ideas')
export class IdeasController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async view(tx: Tx, p: Principal, where: { id?: string; status?: string; sort?: string }) {
    const staff = has(p, 'idea:manage');
    const rows = await sql<{
      id: string;
      title: string;
      body: string;
      family: string | null;
      status: IdeaView['status'];
      response: string | null;
      votes: string;
      voted: boolean;
      author_id: string;
      author: string | null;
      org: string | null;
      hidden: boolean;
      created_at: Date;
    }>`
      SELECT i.id, i.title, i.body, f.name AS family, i.status, i.response,
             (SELECT count(*) FROM idea_vote v WHERE v.idea_id = i.id) AS votes,
             EXISTS (SELECT 1 FROM idea_vote v WHERE v.idea_id = i.id AND v.user_id = ${p.userId}) AS voted,
             i.author_id, u.display_name AS author, o.name AS org, i.hidden, i.created_at
        FROM idea i
        LEFT JOIN product_family f ON f.id = i.family_id
        -- Other customers' people and organisations are invisible (RLS): left joins keep the row.
        LEFT JOIN app_user u ON u.id = i.author_id
        LEFT JOIN organization o ON o.id = i.org_id
       WHERE true
         ${where.id ? sql`AND i.id = ${where.id}` : sql``}
         ${where.status ? sql`AND i.status = ${where.status}` : sql``}
         ${staff ? sql`` : sql`AND (NOT i.hidden OR i.author_id = ${p.userId})`}
       ORDER BY ${where.sort === 'new' ? sql`i.created_at DESC` : sql`votes DESC, i.created_at DESC`}
       LIMIT 200`.execute(tx);
    return rows.rows.map((r): IdeaView => ({
      id: r.id,
      title: r.title,
      body: r.body,
      familyName: r.family,
      status: r.status,
      response: r.response,
      votes: Number(r.votes),
      votedByMe: r.voted,
      mine: r.author_id === p.userId,
      postedBy: staff ? `${r.author}, ${r.org}` : null,
      hidden: r.hidden,
      createdAt: r.created_at.toISOString(),
    }));
  }

  private signedInPerson(p: Principal) {
    if (p.apiKeyId) throw forbidden();
  }

  @Get()
  @RequirePermission('idea:submit', 'idea:manage')
  async list(
    @CurrentPrincipal() p: Principal,
    @Query('status') rawStatus?: string,
    @Query('sort') rawSort?: string,
  ): Promise<{ items: IdeaView[] }> {
    this.signedInPerson(p);
    const status = rawStatus ? parse(IdeaStatus, rawStatus) : undefined;
    const sort = parse(Sort, rawSort ?? 'top');
    return { items: await this.db.withTenant(p, (tx) => this.view(tx, p, { status, sort })) };
  }

  @Post()
  @RequirePermission('idea:submit')
  @RateLimit('idea-create', 10, 3600)
  async create(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<IdeaView> {
    this.signedInPerson(p);
    if (p.isInternal) throw forbidden();
    const b = parse(IdeaCreate, body);
    assertBrandClean({ title: b.title, body: b.body });
    return this.db.withTenant(p, async (tx) => {
      let familyId: string | null = null;
      if (b.familyKey) {
        const f = await tx
          .selectFrom('product_family')
          .select('id')
          .where('key', '=', b.familyKey)
          .executeTakeFirst();
        if (!f) throw unprocessable('family', 'Unknown product family');
        familyId = f.id;
      }
      const id = randomUUID();
      await tx
        .insertInto('idea')
        .values({
          id,
          org_id: p.orgId,
          author_id: p.userId,
          family_id: familyId,
          title: b.title,
          body: b.body,
        })
        .execute();
      // Posting counts as the author's vote.
      await tx.insertInto('idea_vote').values({ idea_id: id, user_id: p.userId }).execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'idea.create',
          orgId: p.orgId,
          targetType: 'idea',
          targetId: id,
          diff: { title: b.title },
        },
      );
      return (await this.view(tx, p, { id }))[0]!;
    });
  }

  @Post(':id/vote')
  @RequirePermission('idea:submit')
  @RateLimit('idea-vote', 120, 3600)
  async vote(@CurrentPrincipal() p: Principal, @Param('id') raw: string): Promise<IdeaView> {
    this.signedInPerson(p);
    const id = parse(Id, raw);
    return this.db.withTenant(p, async (tx) => {
      const i = await tx.selectFrom('idea').select('id').where('id', '=', id).executeTakeFirst();
      if (!i) throw notFound('Suggestion');
      await tx
        .insertInto('idea_vote')
        .values({ idea_id: id, user_id: p.userId })
        .onConflict((oc) => oc.doNothing())
        .execute();
      return (await this.view(tx, p, { id }))[0]!;
    });
  }

  @Delete(':id/vote')
  @HttpCode(200)
  @RequirePermission('idea:submit')
  async unvote(@CurrentPrincipal() p: Principal, @Param('id') raw: string): Promise<IdeaView> {
    this.signedInPerson(p);
    const id = parse(Id, raw);
    return this.db.withTenant(p, async (tx) => {
      await tx
        .deleteFrom('idea_vote')
        .where('idea_id', '=', id)
        .where('user_id', '=', p.userId)
        .execute();
      const v = (await this.view(tx, p, { id }))[0];
      if (!v) throw notFound('Suggestion');
      return v;
    });
  }

  @Put(':id')
  @RequirePermission('idea:manage')
  async respond(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ): Promise<IdeaView> {
    const id = parse(Id, raw);
    const b = parse(IdeaStaffUpdate, body);
    if (b.response) assertBrandClean({ response: b.response });
    return this.db.withTenant(p, async (tx) => {
      const r = await tx
        .updateTable('idea')
        .set({
          status: b.status,
          ...(b.response !== undefined ? { response: b.response || null } : {}),
          ...(b.hidden !== undefined ? { hidden: b.hidden } : {}),
        })
        .where('id', '=', id)
        .returning('org_id')
        .executeTakeFirst();
      if (!r) throw notFound('Suggestion');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'idea.update',
          orgId: r.org_id,
          targetType: 'idea',
          targetId: id,
          diff: { status: b.status, hidden: b.hidden },
        },
      );
      return (await this.view(tx, p, { id }))[0]!;
    });
  }
}
