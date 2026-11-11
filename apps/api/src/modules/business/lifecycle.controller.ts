import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import { ProductLifecycleUpdate, type ProductLifecycleView } from '@wd/contracts';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { assertBrandClean } from '../../common/brand-guard.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { notFound, unprocessable } from '../../common/errors.js';
import { emit } from '../../common/outbox.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { parse } from '../../common/zod.js';

const Id = z.string().uuid();

/** End-of-sale and end-of-support dates per model, with upgrade advice shown beside each device. */
@Controller('api/v1/admin/products')
export class LifecycleController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async list(tx: Tx, id?: string): Promise<ProductLifecycleView[]> {
    const rows = await sql<{
      id: string;
      sku: string;
      model_name: string;
      family: string;
      lifecycle: ProductLifecycleView['lifecycle'];
      eos: string | null;
      eol: string | null;
      repl: string | null;
      note: string | null;
      installed: string;
      customers: string;
    }>`
      SELECT p.id, p.sku, p.model_name, f.name AS family, p.lifecycle,
             to_char(p.eos_date, 'YYYY-MM-DD') AS eos, to_char(p.eol_date, 'YYYY-MM-DD') AS eol,
             r.sku AS repl, p.lifecycle_note AS note,
             (SELECT count(*) FROM asset a WHERE a.product_id = p.id AND a.retired_at IS NULL) AS installed,
             (SELECT count(DISTINCT a.org_id) FROM asset a WHERE a.product_id = p.id AND a.retired_at IS NULL) AS customers
        FROM product p
        JOIN product_family f ON f.id = p.family_id
        LEFT JOIN product r ON r.id = p.replacement_product_id
       ${id ? sql`WHERE p.id = ${id}` : sql``}
       ORDER BY f.sort_order, p.model_name`.execute(tx);
    return rows.rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      modelName: r.model_name,
      familyName: r.family,
      lifecycle: r.lifecycle,
      endOfSale: r.eos,
      endOfSupport: r.eol,
      replacementSku: r.repl,
      advice: r.note,
      installed: Number(r.installed),
      customers: Number(r.customers),
    }));
  }

  @Get()
  @RequirePermission('catalog:manage')
  async all(@CurrentPrincipal() p: Principal): Promise<{ items: ProductLifecycleView[] }> {
    return { items: await this.db.withTenant(p, (tx) => this.list(tx)) };
  }

  @Put(':id/lifecycle')
  @RequirePermission('catalog:manage')
  async update(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ): Promise<ProductLifecycleView> {
    const id = parse(Id, raw);
    const b = parse(ProductLifecycleUpdate, body);
    if (b.advice) assertBrandClean({ advice: b.advice });
    if (b.endOfSale && b.endOfSupport && b.endOfSupport < b.endOfSale)
      throw unprocessable('dates', 'End of support must come after end of sale');
    if (b.lifecycle !== 'ga' && !b.endOfSale && !b.endOfSupport)
      throw unprocessable('dates', 'Give at least one date for customers to plan around');
    return this.db.withTenant(p, async (tx) => {
      let replacement: string | null = null;
      if (b.replacementSku) {
        const r = await tx
          .selectFrom('product')
          .select('id')
          .where('sku', '=', b.replacementSku)
          .executeTakeFirst();
        if (!r || r.id === id)
          throw unprocessable('replacement', 'Choose another model as the replacement');
        replacement = r.id;
      }
      const u = await tx
        .updateTable('product')
        .set({
          lifecycle: b.lifecycle,
          eos_date: b.endOfSale,
          eol_date: b.endOfSupport,
          replacement_product_id: replacement,
          lifecycle_note: b.advice || null,
        })
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      if (!u) throw notFound('Product');
      if (b.notify && b.lifecycle !== 'ga')
        await emit(tx, 'product.lifecycle', null, { productId: id });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'product.lifecycle',
          orgId: null,
          targetType: 'product',
          targetId: id,
          diff: {
            lifecycle: b.lifecycle,
            eos: b.endOfSale,
            eol: b.endOfSupport,
            notified: b.notify,
          },
        },
      );
      return (await this.list(tx, id))[0]!;
    });
  }
}
