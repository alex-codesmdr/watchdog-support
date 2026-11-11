import { Body, Controller, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { DepotCreate, SpareLevelSet, SparesAdd, type StockView } from '@wd/contracts';
import { sql } from 'kysely';
import { z } from 'zod';
import { INTERNAL_ORG_ID, type Database, type Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import { conflict, notFound, unprocessable } from '../../common/errors.js';
import { emit } from '../../common/outbox.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { parse } from '../../common/zod.js';

const Serial = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{6,32}$/);
const Id = z.string().uuid();

/** Spare units in stock at a depot, by model: WatchDog-owned devices that are not installed. */
export async function stockView(tx: Tx): Promise<StockView> {
  const depots = await tx
    .selectFrom('depot')
    .select(['id', 'name', 'city', 'state'])
    .where('active', '=', true)
    .orderBy('name')
    .execute();
  const units = await sql<{ product_id: string; depot_id: string; serials: string[] }>`
    SELECT a.product_id, a.depot_id, array_agg(a.serial_number ORDER BY a.serial_number) AS serials
      FROM asset a
     WHERE a.org_id = ${INTERNAL_ORG_ID} AND a.depot_id IS NOT NULL AND a.retired_at IS NULL
     GROUP BY a.product_id, a.depot_id`.execute(tx);
  const levels = await tx.selectFrom('spare_level').selectAll().execute();
  const products = await tx
    .selectFrom('product')
    .select(['id', 'sku', 'model_name'])
    .where('lifecycle', '!=', 'eol')
    .orderBy('model_name')
    .execute();
  let below = 0;
  return {
    depots,
    products: products.map((p) => {
      const byDepot = depots.map((d) => {
        const serials =
          units.rows.find((u) => u.product_id === p.id && u.depot_id === d.id)?.serials ?? [];
        const min =
          levels.find((l) => l.product_id === p.id && l.depot_id === d.id)?.min_on_hand ?? 0;
        if (serials.length < min) below++;
        return { depotId: d.id, onHand: serials.length, min, serials };
      });
      return {
        id: p.id,
        sku: p.sku,
        modelName: p.model_name,
        total: byDepot.reduce((n, d) => n + d.onHand, 0),
        byDepot,
      };
    }),
    belowMinimum: below,
  };
}

/** After a spare leaves a depot: tell coordinators if that model is now below its minimum. */
export async function checkLowStock(tx: Tx, depotId: string, productId: string) {
  const r = await sql<{ on_hand: string; min: number | null }>`
    SELECT (SELECT count(*) FROM asset a WHERE a.org_id = ${INTERNAL_ORG_ID} AND a.depot_id = ${depotId}
              AND a.product_id = ${productId} AND a.retired_at IS NULL) AS on_hand,
           (SELECT min_on_hand FROM spare_level WHERE depot_id = ${depotId} AND product_id = ${productId}) AS min`.execute(
    tx,
  );
  const x = r.rows[0]!;
  if (x.min !== null && Number(x.on_hand) < x.min)
    await emit(tx, 'stock.low', null, {
      depotId,
      productId,
      onHand: Number(x.on_hand),
      min: x.min,
    });
}

/**
 * Spare-parts stock at WatchDog depots. Coordinators add spares by serial number, move them between
 * depots, write them off, and set a minimum per model; shipping a spare as an RMA replacement takes
 * it out of stock automatically.
 */
@Controller('api/v1/workspace/stock')
export class StockController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @RequirePermission('stock:manage', 'rma:manage')
  get(@CurrentPrincipal() p: Principal): Promise<StockView> {
    return this.db.withTenant(p, (tx) => stockView(tx));
  }

  /** Spares that could replace the device on an RMA (same model), by depot. */
  @Get('for-rma/:number')
  @RequirePermission('rma:manage')
  async forRma(@CurrentPrincipal() p: Principal, @Param('number') raw: string) {
    const number = parse(z.string().regex(/^RMA-\d{4}-\d{4,6}$/i), raw).toUpperCase();
    return this.db.withTenant(p, async (tx) => {
      const r = await tx
        .selectFrom('rma as r')
        .innerJoin('asset as a', 'a.id', 'r.asset_id')
        .select('a.product_id')
        .where('r.number', '=', number)
        .executeTakeFirst();
      if (!r) throw notFound('RMA');
      const v = await stockView(tx);
      const prod = v.products.find((x) => x.id === r.product_id);
      return {
        depots: v.depots
          .map((d) => ({
            depotId: d.id,
            name: d.name,
            city: d.city,
            serials: prod?.byDepot.find((b) => b.depotId === d.id)?.serials ?? [],
          }))
          .filter((d) => d.serials.length),
      };
    });
  }

  @Post('depots')
  @RequirePermission('stock:manage')
  async depot(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(DepotCreate, body);
    return this.db.withTenant(p, async (tx) => {
      const dup = await tx
        .selectFrom('depot')
        .select('id')
        .where('name', '=', b.name)
        .executeTakeFirst();
      if (dup) throw conflict('depot-exists', 'A depot with this name already exists');
      const d = await tx.insertInto('depot').values(b).returning('id').executeTakeFirstOrThrow();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'stock.depot', orgId: null, targetType: 'depot', targetId: d.id, diff: b },
      );
      return stockView(tx);
    });
  }

  private async product(tx: Tx, sku: string) {
    const pr = await tx
      .selectFrom('product')
      .select('id')
      .where('sku', '=', sku)
      .executeTakeFirst();
    if (!pr) throw unprocessable('sku', 'Unknown model');
    return pr.id;
  }
  private async activeDepot(tx: Tx, id: string) {
    const d = await tx
      .selectFrom('depot')
      .select('id')
      .where('id', '=', id)
      .where('active', '=', true)
      .executeTakeFirst();
    if (!d) throw unprocessable('depotId', 'Choose a depot');
  }

  @Post('spares')
  @RequirePermission('stock:manage')
  async add(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(SparesAdd, body);
    const serials = [...new Set(b.serials)];
    return this.db.withTenant(p, async (tx) => {
      await this.activeDepot(tx, b.depotId);
      const productId = await this.product(tx, b.sku);
      const taken = await tx
        .selectFrom('asset')
        .select('serial_number')
        .where('serial_number', 'in', serials)
        .execute();
      if (taken.length)
        throw conflict(
          'serial-exists',
          `Already registered: ${taken.map((t) => t.serial_number).join(', ')}`,
        );
      await tx
        .insertInto('asset')
        .values(
          serials.map((s) => ({
            org_id: INTERNAL_ORG_ID,
            product_id: productId,
            serial_number: s,
            depot_id: b.depotId,
          })),
        )
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'stock.add',
          orgId: null,
          targetType: 'depot',
          targetId: b.depotId,
          diff: { sku: b.sku, count: serials.length },
        },
      );
      return stockView(tx);
    });
  }

  private async spare(tx: Tx, raw: string) {
    const a = await tx
      .selectFrom('asset')
      .select(['id', 'depot_id', 'product_id', 'serial_number'])
      .where('serial_number', '=', parse(Serial, raw))
      .where('org_id', '=', INTERNAL_ORG_ID)
      .where('retired_at', 'is', null)
      .where('depot_id', 'is not', null)
      .executeTakeFirst();
    if (!a) throw notFound('Spare unit');
    return a;
  }

  @Post('spares/:serial/move')
  @RequirePermission('stock:manage')
  async move(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('serial') raw: string,
    @Body() body: unknown,
  ) {
    const { depotId } = parse(z.object({ depotId: Id }), body);
    return this.db.withTenant(p, async (tx) => {
      const a = await this.spare(tx, raw);
      await this.activeDepot(tx, depotId);
      await tx.updateTable('asset').set({ depot_id: depotId }).where('id', '=', a.id).execute();
      await checkLowStock(tx, a.depot_id!, a.product_id);
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'stock.move',
          orgId: null,
          targetType: 'asset',
          targetId: a.id,
          diff: { from: a.depot_id, to: depotId },
        },
      );
      return stockView(tx);
    });
  }

  @Post('spares/:serial/write-off')
  @RequirePermission('stock:manage')
  async writeOff(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('serial') raw: string,
    @Body() body: unknown,
  ) {
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), body);
    return this.db.withTenant(p, async (tx) => {
      const a = await this.spare(tx, raw);
      await tx
        .updateTable('asset')
        .set({ retired_at: new Date(), depot_id: null })
        .where('id', '=', a.id)
        .execute();
      await checkLowStock(tx, a.depot_id!, a.product_id);
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'stock.write_off',
          orgId: null,
          targetType: 'asset',
          targetId: a.id,
          diff: { serial: a.serial_number, reason },
        },
      );
      return stockView(tx);
    });
  }

  @Put('levels')
  @RequirePermission('stock:manage')
  async level(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(SpareLevelSet, body);
    return this.db.withTenant(p, async (tx) => {
      await this.activeDepot(tx, b.depotId);
      const productId = await this.product(tx, b.sku);
      await tx
        .insertInto('spare_level')
        .values({ depot_id: b.depotId, product_id: productId, min_on_hand: b.min })
        .onConflict((oc) =>
          oc.columns(['depot_id', 'product_id']).doUpdateSet({ min_on_hand: b.min }),
        )
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'stock.level',
          orgId: null,
          targetType: 'depot',
          targetId: b.depotId,
          diff: { sku: b.sku, min: b.min },
        },
      );
      return stockView(tx);
    });
  }
}
