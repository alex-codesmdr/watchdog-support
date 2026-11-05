import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { SavedReplyRequest, type SavedReply } from '@wd/contracts';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import type { SavedReplyT } from '../../db/schema.js';
import { DB } from '../../tokens.js';
import { CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { assertBrandClean } from '../../common/brand-guard.js';
import { forbidden, notFound } from '../../common/errors.js';
import { has, type Principal } from '../../common/principal.js';
import { parse } from '../../common/zod.js';

const Id = z.string().uuid();
const MAX_PERSONAL = 200;

/**
 * Saved replies for engineers: personal ones, plus shared ones that support managers curate.
 * Staff-only by RLS as well as permission. Placeholders are filled in by the reply box.
 */
@Controller('api/v1/saved-replies')
export class SavedRepliesController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private view(p: Principal, r: Selectable<SavedReplyT>): SavedReply {
    const shared = r.owner_id === null;
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      shared,
      editable: shared ? has(p, 'reply:template:share') : r.owner_id === p.userId,
      updatedAt: r.updated_at.toISOString(),
    };
  }

  private staffOnly(p: Principal) {
    if (!p.isInternal || p.apiKeyId) throw forbidden();
  }

  private async own(tx: Tx, p: Principal, id: string) {
    const r = await tx
      .selectFrom('saved_reply')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw notFound('Saved reply');
    if (!this.view(p, r).editable)
      throw forbidden('Only support managers can change shared replies.');
    return r;
  }

  private values(p: Principal, body: unknown) {
    const v = parse(SavedReplyRequest, body);
    if (v.shared && !has(p, 'reply:template:share'))
      throw forbidden('Only support managers can share replies with every engineer.');
    assertBrandClean({ title: v.title, body: v.body });
    return v;
  }

  @Get()
  @RequirePermission('case:note:internal')
  list(@CurrentPrincipal() p: Principal): Promise<{ items: SavedReply[] }> {
    this.staffOnly(p);
    return this.db.withTenant(p, async (tx) => {
      const rows = await tx
        .selectFrom('saved_reply')
        .selectAll()
        .orderBy((eb) => eb.case().when('owner_id', 'is', null).then(1).else(0).end())
        .orderBy('title')
        .limit(MAX_PERSONAL + 200)
        .execute();
      return { items: rows.map((r) => this.view(p, r)) };
    });
  }

  @Post()
  @RequirePermission('case:note:internal')
  create(@CurrentPrincipal() p: Principal, @Body() body: unknown): Promise<SavedReply> {
    this.staffOnly(p);
    const v = this.values(p, body);
    return this.db.withTenant(p, async (tx) => {
      if (!v.shared) {
        const n = await tx
          .selectFrom('saved_reply')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('owner_id', '=', p.userId)
          .executeTakeFirstOrThrow();
        if (Number(n.n) >= MAX_PERSONAL)
          throw forbidden(`You can keep up to ${MAX_PERSONAL} personal saved replies.`);
      }
      const r = await tx
        .insertInto('saved_reply')
        .values({
          owner_id: v.shared ? null : p.userId,
          title: v.title,
          body: v.body,
          created_by: p.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return this.view(p, r);
    });
  }

  @Put(':id')
  @RequirePermission('case:note:internal')
  update(@CurrentPrincipal() p: Principal, @Param('id') raw: string, @Body() body: unknown) {
    this.staffOnly(p);
    const id = parse(Id, raw);
    const v = this.values(p, body);
    return this.db.withTenant(p, async (tx) => {
      await this.own(tx, p, id);
      const r = await tx
        .updateTable('saved_reply')
        .set({ title: v.title, body: v.body, owner_id: v.shared ? null : p.userId })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return this.view(p, r);
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('case:note:internal')
  async remove(@CurrentPrincipal() p: Principal, @Param('id') raw: string) {
    this.staffOnly(p);
    const id = parse(Id, raw);
    await this.db.withTenant(p, async (tx) => {
      await this.own(tx, p, id);
      await tx.deleteFrom('saved_reply').where('id', '=', id).execute();
    });
  }
}
