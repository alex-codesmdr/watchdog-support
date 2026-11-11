import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  ForumAccept,
  ForumAnswerCreate,
  ForumHide,
  ForumQuestionCreate,
  type ForumQuestionSummary,
  type ForumQuestionView,
} from '@wd/contracts';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { assertBrandClean } from '../../common/brand-guard.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { forbidden, notFound, unprocessable } from '../../common/errors.js';
import { emit } from '../../common/outbox.js';
import { has, type Principal, type RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';

const Id = z.string().uuid();
const excerpt = (t: string, n = 220) =>
  t.length > n ? `${t.slice(0, t.lastIndexOf(' ', n))}…` : t;

/**
 * Community answers: customers, partners and WatchDog engineers ask and answer questions. People
 * appear by first name and initial only, never by organisation; engineers are marked. The asker
 * or an engineer marks the answer that solved it; engineers hide anything unsuitable.
 */
@Controller('api/v1/community')
export class CommunityController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private person(p: Principal) {
    if (p.apiKeyId) throw forbidden();
  }

  @Get()
  @RequirePermission('community:post')
  async list(
    @CurrentPrincipal() p: Principal,
    @Query('q') rawQ?: string,
    @Query('show') show?: string,
  ): Promise<{ items: ForumQuestionSummary[] }> {
    this.person(p);
    const q = z
      .string()
      .trim()
      .max(120)
      .parse(rawQ ?? '');
    const words = q
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2)
      .slice(0, 8);
    const rows = await this.db.withTenant(p, (tx) =>
      sql<{
        id: string;
        title: string;
        body: string;
        family: string | null;
        author: string;
        answers: string;
        solved: boolean;
        hidden: boolean;
        created_at: Date;
      }>`
        SELECT f.id, f.title, f.body, pf.name AS family, wd.public_name(f.author_id) AS author,
               (SELECT count(*) FROM forum_answer a WHERE a.question_id = f.id AND NOT a.hidden) AS answers,
               f.accepted_answer_id IS NOT NULL AS solved, f.hidden, f.created_at
          FROM forum_question f
          LEFT JOIN product_family pf ON pf.id = f.family_id
         WHERE true
           ${words.length ? sql`AND f.search_vec @@ to_tsquery('english', ${words.join(' | ')})` : sql``}
           ${show === 'unanswered' ? sql`AND f.accepted_answer_id IS NULL AND NOT EXISTS (SELECT 1 FROM forum_answer a WHERE a.question_id = f.id)` : sql``}
         ORDER BY ${words.length ? sql`ts_rank_cd(f.search_vec, to_tsquery('english', ${words.join(' | ')})) DESC,` : sql``} f.created_at DESC
         LIMIT 100`.execute(tx),
    );
    return {
      items: rows.rows.map((r) => ({
        id: r.id,
        title: r.title,
        excerpt: excerpt(r.body),
        familyName: r.family,
        author: r.author,
        answers: Number(r.answers),
        solved: r.solved,
        hidden: r.hidden,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }

  private async view(tx: Tx, p: Principal, id: string): Promise<ForumQuestionView> {
    const q = await sql<{
      id: string;
      title: string;
      body: string;
      family: string | null;
      author: string;
      author_id: string;
      accepted: string | null;
      hidden: boolean;
      created_at: Date;
    }>`
      SELECT f.id, f.title, f.body, pf.name AS family, wd.public_name(f.author_id) AS author, f.author_id,
             f.accepted_answer_id AS accepted, f.hidden, f.created_at
        FROM forum_question f LEFT JOIN product_family pf ON pf.id = f.family_id
       WHERE f.id = ${id}`.execute(tx);
    const f = q.rows[0];
    if (!f) throw notFound('Question');
    const answers = await sql<{
      id: string;
      body: string;
      author: string;
      author_id: string;
      by_staff: boolean;
      hidden: boolean;
      created_at: Date;
    }>`
      SELECT a.id, a.body, wd.public_name(a.author_id) AS author, a.author_id, a.by_staff, a.hidden, a.created_at
        FROM forum_answer a WHERE a.question_id = ${id}
       ORDER BY a.id = ${f.accepted ?? '00000000-0000-0000-0000-000000000000'} DESC, a.by_staff DESC, a.created_at`.execute(
      tx,
    );
    const moderator = has(p, 'community:moderate');
    const visible = answers.rows;
    return {
      id: f.id,
      title: f.title,
      body: f.body,
      excerpt: excerpt(f.body),
      familyName: f.family,
      author: f.author,
      answers: visible.filter((a) => !a.hidden).length,
      solved: !!f.accepted,
      hidden: f.hidden,
      createdAt: f.created_at.toISOString(),
      mine: f.author_id === p.userId,
      canAccept: f.author_id === p.userId || moderator,
      canModerate: moderator,
      answerList: visible.map((a) => ({
        id: a.id,
        body: a.body,
        author: a.author,
        byStaff: a.by_staff,
        accepted: a.id === f.accepted,
        hidden: a.hidden,
        mine: a.author_id === p.userId,
        createdAt: a.created_at.toISOString(),
      })),
    };
  }

  @Get(':id')
  @RequirePermission('community:post')
  get(@CurrentPrincipal() p: Principal, @Param('id') raw: string): Promise<ForumQuestionView> {
    this.person(p);
    const id = parse(Id, raw);
    return this.db.withTenant(p, (tx) => this.view(tx, p, id));
  }

  @Post()
  @RequirePermission('community:post')
  @RateLimit('community-ask', 10, 3600)
  async ask(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<ForumQuestionView> {
    this.person(p);
    const b = parse(ForumQuestionCreate, body);
    assertBrandClean({ title: b.title, body: b.body });
    return this.db.withTenant(p, async (tx) => {
      let familyId: string | null = null;
      if (b.familyKey) {
        const fam = await tx
          .selectFrom('product_family')
          .select('id')
          .where('key', '=', b.familyKey)
          .executeTakeFirst();
        if (!fam) throw unprocessable('family', 'Unknown product family');
        familyId = fam.id;
      }
      const id = randomUUID();
      await tx
        .insertInto('forum_question')
        .values({
          id,
          org_id: p.orgId,
          author_id: p.userId,
          family_id: familyId,
          title: b.title,
          body: b.body,
        })
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'community.ask',
          orgId: p.orgId,
          targetType: 'forum_question',
          targetId: id,
          diff: {},
        },
      );
      return this.view(tx, p, id);
    });
  }

  @Post(':id/answers')
  @RequirePermission('community:post')
  @RateLimit('community-answer', 30, 3600)
  async answer(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ): Promise<ForumQuestionView> {
    this.person(p);
    const id = parse(Id, raw);
    const b = parse(ForumAnswerCreate, body);
    assertBrandClean({ body: b.body });
    return this.db.withTenant(p, async (tx) => {
      const q = await tx
        .selectFrom('forum_question')
        .select(['id', 'author_id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!q) throw notFound('Question');
      const aid = randomUUID();
      await tx
        .insertInto('forum_answer')
        .values({
          id: aid,
          question_id: id,
          org_id: p.orgId,
          author_id: p.userId,
          body: b.body,
          by_staff: p.isInternal,
        })
        .execute();
      if (q.author_id !== p.userId)
        await emit(tx, 'community.answered', null, { questionId: id, answerId: aid });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'community.answer',
          orgId: p.orgId,
          targetType: 'forum_question',
          targetId: id,
          diff: {},
        },
      );
      return this.view(tx, p, id);
    });
  }

  @Post(':id/accept')
  @RequirePermission('community:post')
  async accept(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ): Promise<ForumQuestionView> {
    this.person(p);
    const id = parse(Id, raw);
    const { answerId } = parse(ForumAccept, body);
    return this.db.withTenant(p, async (tx) => {
      const q = await tx
        .selectFrom('forum_question')
        .select(['author_id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!q) throw notFound('Question');
      if (q.author_id !== p.userId && !has(p, 'community:moderate')) throw forbidden();
      if (answerId) {
        const a = await tx
          .selectFrom('forum_answer')
          .select('id')
          .where('id', '=', answerId)
          .where('question_id', '=', id)
          .where('hidden', '=', false)
          .executeTakeFirst();
        if (!a) throw unprocessable('answerId', 'Choose an answer to this question');
      }
      await tx
        .updateTable('forum_question')
        .set({ accepted_answer_id: answerId })
        .where('id', '=', id)
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'community.accept',
          orgId: null,
          targetType: 'forum_question',
          targetId: id,
          diff: { answerId },
        },
      );
      return this.view(tx, p, id);
    });
  }

  @Post(':id/hide')
  @RequirePermission('community:moderate')
  async hideQuestion(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ): Promise<ForumQuestionView> {
    const id = parse(Id, raw);
    const { hidden } = parse(ForumHide, body);
    return this.db.withTenant(p, async (tx) => {
      const r = await tx
        .updateTable('forum_question')
        .set({ hidden })
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      if (!r) throw notFound('Question');
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'community.hide',
          orgId: null,
          targetType: 'forum_question',
          targetId: id,
          diff: { hidden },
        },
      );
      return this.view(tx, p, id);
    });
  }

  @Post(':id/answers/:aid/hide')
  @RequirePermission('community:moderate')
  async hideAnswer(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Param('aid') rawA: string,
    @Body() body: unknown,
  ): Promise<ForumQuestionView> {
    const id = parse(Id, raw);
    const aid = parse(Id, rawA);
    const { hidden } = parse(ForumHide, body);
    return this.db.withTenant(p, async (tx) => {
      const r = await tx
        .updateTable('forum_answer')
        .set({ hidden })
        .where('id', '=', aid)
        .where('question_id', '=', id)
        .returning('id')
        .executeTakeFirst();
      if (!r) throw notFound('Answer');
      if (hidden)
        await tx
          .updateTable('forum_question')
          .set({ accepted_answer_id: null })
          .where('id', '=', id)
          .where('accepted_answer_id', '=', aid)
          .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'community.hide_answer',
          orgId: null,
          targetType: 'forum_question',
          targetId: id,
          diff: { aid, hidden },
        },
      );
      return this.view(tx, p, id);
    });
  }
}
