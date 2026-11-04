import { Controller, Get, Inject, Param } from '@nestjs/common';
import { sql } from 'kysely';
import type { ProductFamily, ProductPublic } from '@wd/contracts';
import type { Database } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { CurrentPrincipal, Public, RequirePermission } from '../../common/auth.js';
import { notFound } from '../../common/errors.js';
import type { Principal } from '../../common/principal.js';

@Controller('api/v1/catalog')
export class CatalogController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Public()
  @Get('families')
  async families(): Promise<{ items: Array<ProductFamily & { productCount: number }> }> {
    const rows = await this.db.withAnonymous((tx) =>
      tx
        .selectFrom('product_family as f')
        .leftJoin('product as p', 'p.family_id', 'f.id')
        .select(['f.id', 'f.key', 'f.name', 'f.description', sql<string>`count(p.id)`.as('n')])
        .groupBy('f.id')
        .orderBy('f.sort_order')
        .execute(),
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        productCount: Number(r.n),
      })),
    };
  }

  @Public()
  @Get('products')
  async products(): Promise<{ items: ProductPublic[] }> {
    // Explicit column list: the app role has no privilege on internal_oem_ref at all.
    const rows = await this.db.withAnonymous((tx) =>
      tx
        .selectFrom('product')
        .select(['id', 'family_id', 'sku', 'model_name', 'lifecycle'])
        .orderBy('sku')
        .execute(),
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        familyId: r.family_id,
        sku: r.sku,
        modelName: r.model_name,
        lifecycle: r.lifecycle,
      })),
    };
  }

  /** Internal mapping for PSIRT / RMA staff only. */
  @Get('products/:sku/internal')
  @RequirePermission('product:read:internal_ref')
  async internal(@CurrentPrincipal() p: Principal, @Param('sku') sku: string) {
    return this.db.withTenant(p, async (tx) => {
      const prod = await tx
        .selectFrom('product')
        .select(['id', 'family_id', 'sku', 'model_name', 'lifecycle'])
        .where('sku', '=', sku)
        .executeTakeFirst();
      if (!prod) throw notFound('Product');
      const ref = await sql<{
        r: string | null;
      }>`SELECT wd.product_internal_ref(${sku}) AS r`.execute(tx);
      return {
        id: prod.id,
        familyId: prod.family_id,
        sku: prod.sku,
        modelName: prod.model_name,
        lifecycle: prod.lifecycle,
        internalOemRef: ref.rows[0]?.r ?? null,
      };
    });
  }
}
