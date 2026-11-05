import { Inject, Injectable } from '@nestjs/common';
import { sql, type ExpressionBuilder } from 'kysely';
import {
  rmaNext,
  RMA_OPEN,
  type RmaCreateRequest,
  type RmaStatus,
  type RmaSummary,
  type RmaTransitionRequest,
  type RmaView,
} from '@wd/contracts';
import type { Database, Tx } from '../../db/database.js';
import type { DB as Schema } from '../../db/schema.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors.js';
import { emit } from '../../common/outbox.js';
import { has, type Principal, type RequestContext } from '../../common/principal.js';

const INTERNAL_ORG_ID = '00000000-0000-4000-8000-000000000100';
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

/**
 * RMA workflow. Who may see an RMA follows who may see its case. Customers request and send the
 * faulty unit back; RMA coordinators approve, ship, receive and close. Shipping a replacement moves
 * the remaining coverage to the new serial and retires the old device.
 */
@Injectable()
export class RmaService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Inner wall mirroring case visibility (RLS is the outer one). */
  private scope(p: Principal) {
    return (eb: ExpressionBuilder<Schema & { c: Schema['support_case'] }, 'c'>) => {
      const ors = [eb('c.requester_id', '=', p.userId)];
      // API keys with the rmas:read scope see the organisation's RMAs.
      if (has(p, 'case:read:org') || has(p, 'rma:read')) ors.push(eb('c.org_id', '=', p.orgId));
      if (has(p, 'case:read:delegated') && p.delegatedOrgIds.length)
        ors.push(eb('c.org_id', 'in', p.delegatedOrgIds));
      return eb.or(ors);
    };
  }

  private base(tx: Tx, p: Principal) {
    let q = tx
      .selectFrom('rma as r')
      .innerJoin('support_case as c', 'c.id', 'r.case_id')
      .innerJoin('asset as a', 'a.id', 'r.asset_id')
      .innerJoin('product as pr', 'pr.id', 'a.product_id')
      .innerJoin('organization as o', 'o.id', 'r.org_id')
      .selectAll('r')
      .select([
        'c.number as case_number',
        'a.serial_number',
        'pr.model_name',
        'o.name as org_name',
      ]);
    if (!has(p, 'case:read:all')) q = q.where(this.scope(p) as never);
    return q;
  }

  private summary(r: {
    id: string;
    number: string;
    case_number: string;
    org_id: string;
    org_name: string;
    serial_number: string;
    model_name: string;
    type: RmaSummary['type'];
    status: RmaSummary['status'];
    created_at: Date;
    updated_at: Date;
  }): RmaSummary {
    return {
      id: r.id,
      number: r.number,
      caseNumber: r.case_number,
      org: { id: r.org_id, name: r.org_name },
      serialNumber: r.serial_number,
      modelName: r.model_name,
      type: r.type,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }

  async list(p: Principal, q: { status?: 'open' | 'closed'; caseNumber?: string }) {
    return this.db.withTenant(p, async (tx) => {
      let s = this.base(tx, p).orderBy('r.created_at', 'desc').limit(200);
      if (q.status === 'open') s = s.where('r.status', 'in', [...RMA_OPEN]);
      if (q.status === 'closed') s = s.where('r.status', 'not in', [...RMA_OPEN]);
      if (q.caseNumber) s = s.where('c.number', '=', q.caseNumber);
      return { items: (await s.execute()).map((r) => this.summary(r)) };
    });
  }

  async get(p: Principal, number: string): Promise<RmaView> {
    return this.db.withTenant(p, async (tx) => {
      const r = await this.base(tx, p).where('r.number', '=', number).executeTakeFirst();
      if (!r) throw notFound('RMA');
      const ev = await tx
        .selectFrom('rma_event as e')
        .leftJoin('app_user as u', 'u.id', 'e.actor_id')
        .select(['e.at', 'e.from_status', 'e.to_status', 'e.note', 'e.actor_id'])
        .where('e.rma_id', '=', r.id)
        .orderBy('e.at')
        .execute();
      const ids = [...new Set(ev.map((e) => e.actor_id).filter((x): x is string => !!x))];
      const names = await sql<{ id: string; display_name: string; is_staff: boolean }>`
        SELECT * FROM wd.display_names(${ids}::uuid[])`.execute(tx);
      const who = (id: string | null) => {
        const n = names.rows.find((x) => x.id === id);
        return n
          ? n.is_staff && !p.isInternal
            ? 'WatchDog Support'
            : n.display_name
          : 'WatchDog Support';
      };
      return {
        ...this.summary(r),
        faultDescription: r.fault_description,
        shipTo: {
          contactName: r.contact_name,
          contactPhone: r.contact_phone,
          address: r.address,
          city: r.city,
          state: r.state,
          pincode: r.pincode,
        },
        replacementSerial: r.replacement_serial,
        outbound: { courier: r.outbound_courier, trackingNumber: r.outbound_tracking },
        inbound: { courier: r.inbound_courier, trackingNumber: r.inbound_tracking },
        events: ev.map((e) => ({
          at: e.at.toISOString(),
          from: e.from_status as RmaStatus | null,
          to: e.to_status as RmaStatus,
          actor: who(e.actor_id),
          note: e.note,
        })),
        next: this.next(p, r),
      };
    });
  }

  private next(
    p: Principal,
    r: {
      status: RmaStatus;
      type: RmaView['type'];
      shipped_at: Date | null;
      received_at: Date | null;
    },
  ): RmaStatus[] {
    const state = {
      status: r.status,
      type: r.type,
      shipped: !!r.shipped_at,
      received: !!r.received_at,
    };
    if (has(p, 'rma:manage')) return rmaNext(state, 'coordinator');
    if (has(p, 'rma:request') && !p.isInternal) return rmaNext(state, 'customer');
    return [];
  }

  async create(
    p: Principal,
    ctx: RequestContext,
    caseRef: string,
    b: RmaCreateRequest,
  ): Promise<RmaView> {
    const number = await this.db.withTenant(p, async (tx) => {
      let cq = tx
        .selectFrom('support_case as c')
        .select(['c.id', 'c.org_id', 'c.asset_id', 'c.status', 'c.number'])
        .where('c.number', '=', caseRef);
      if (!has(p, 'case:read:all')) cq = cq.where(this.scope(p) as never);
      const c = await cq.executeTakeFirst();
      if (!c) throw notFound('Case');
      if (c.status === 'closed')
        throw conflict('case-closed', 'Reopen the case before requesting a replacement');
      const assetId = b.assetId ?? c.asset_id;
      if (!assetId) throw unprocessable('assetId', 'Choose the device to replace');
      const a = await tx
        .selectFrom('asset')
        .select(['id', 'org_id', 'retired_at'])
        .where('id', '=', assetId)
        .executeTakeFirst();
      if (!a || a.org_id !== c.org_id || a.retired_at)
        throw unprocessable(
          'assetId',
          'The device must be an installed device of the case organisation',
        );
      const cover = await tx
        .selectFrom('entitlement')
        .select(['tier'])
        .where('asset_id', '=', a.id)
        .where(sql<boolean>`current_date BETWEEN starts_on AND ends_on`)
        .execute();
      if (!cover.length && !has(p, 'rma:manage'))
        throw unprocessable('assetId', 'This device has no active warranty or support contract');
      // Advance replacement is a Premium / Mission-Critical benefit (coordinators may override).
      if (
        b.type === 'advance' &&
        !has(p, 'rma:manage') &&
        !cover.some((x) => x.tier === 'premium' || x.tier === 'mission_critical')
      )
        throw unprocessable(
          'type',
          'Advance replacement needs Premium or Mission-Critical coverage',
        );
      const open = await tx
        .selectFrom('rma')
        .select('number')
        .where('asset_id', '=', a.id)
        .where('status', 'in', [...RMA_OPEN])
        .executeTakeFirst();
      if (open) throw conflict('rma-open', `${open.number} is already open for this device`);
      const status = has(p, 'rma:manage') ? 'approved' : 'requested';
      const r = await tx
        .insertInto('rma')
        .values({
          org_id: c.org_id,
          case_id: c.id,
          asset_id: a.id,
          type: b.type,
          status,
          fault_description: b.faultDescription,
          contact_name: b.contactName,
          contact_phone: b.contactPhone,
          address: b.address,
          city: b.city,
          state: b.state,
          pincode: b.pincode,
          requested_by: p.userId,
        })
        .returning(['id', 'number'])
        .executeTakeFirstOrThrow();
      await this.record(
        tx,
        p,
        ctx,
        { id: r.id, number: r.number, org_id: c.org_id, case_id: c.id },
        null,
        status,
        null,
      );
      return r.number;
    });
    return this.get(p, number);
  }

  async transition(
    p: Principal,
    ctx: RequestContext,
    number: string,
    b: RmaTransitionRequest,
  ): Promise<RmaView> {
    await this.db.withTenant(p, async (tx) => {
      const r = await this.base(tx, p)
        .where('r.number', '=', number)
        .forUpdate('r')
        .executeTakeFirst();
      if (!r) throw notFound('RMA');
      if (!this.next(p, r).includes(b.to)) {
        if (!has(p, 'rma:manage') && !has(p, 'rma:request')) throw forbidden();
        throw conflict(
          'invalid-transition',
          `An RMA that is "${r.status}" cannot move to "${b.to}"`,
        );
      }
      const set: Record<string, unknown> = { status: b.to, version: sql`version + 1` };
      if (b.to === 'return_in_transit') {
        if (!b.trackingNumber)
          throw unprocessable(
            'trackingNumber',
            'Enter the courier tracking number for the faulty unit',
          );
        set.inbound_courier = b.courier ?? null;
        set.inbound_tracking = b.trackingNumber;
      }
      if (b.to === 'received') set.received_at = new Date();
      if (b.to === 'replacement_shipped') {
        if (!b.replacementSerial || !b.trackingNumber)
          throw unprocessable(
            'replacementSerial',
            'Enter the replacement serial number and tracking number',
          );
        const newAsset = await this.swapDevice(tx, r, b.replacementSerial);
        Object.assign(set, {
          replacement_serial: b.replacementSerial,
          replacement_asset_id: newAsset,
          outbound_courier: b.courier ?? null,
          outbound_tracking: b.trackingNumber,
          shipped_at: new Date(),
        });
      }
      if ((b.to === 'rejected' || b.to === 'cancelled') && !b.note && has(p, 'rma:manage'))
        throw unprocessable('note', 'Tell the customer why');
      await tx.updateTable('rma').set(set).where('id', '=', r.id).execute();
      await this.record(tx, p, ctx, r, r.status, b.to, b.note ?? null);
    });
    return this.get(p, number);
  }

  /**
   * Registers the replacement unit for the customer (or takes it from WatchDog spare stock), moves
   * the remaining coverage to it, and retires the faulty unit.
   */
  private async swapDevice(
    tx: Tx,
    r: { id: string; org_id: string; asset_id: string; number: string },
    serial: string,
  ): Promise<string> {
    const old = await tx
      .selectFrom('asset')
      .select(['id', 'product_id', 'site_id'])
      .where('id', '=', r.asset_id)
      .executeTakeFirstOrThrow();
    const existing = await tx
      .selectFrom('asset')
      .select(['id', 'org_id', 'product_id', 'retired_at'])
      .where('serial_number', '=', serial)
      .executeTakeFirst();
    let newId: string;
    if (existing) {
      if (existing.org_id !== INTERNAL_ORG_ID || existing.retired_at)
        throw unprocessable(
          'replacementSerial',
          'This serial number belongs to another installed device',
        );
      if (existing.product_id !== old.product_id)
        throw unprocessable('replacementSerial', 'The replacement must be the same model');
      await tx
        .updateTable('asset')
        .set({ org_id: r.org_id, site_id: old.site_id })
        .where('id', '=', existing.id)
        .execute();
      newId = existing.id;
    } else {
      const a = await tx
        .insertInto('asset')
        .values({
          org_id: r.org_id,
          product_id: old.product_id,
          serial_number: serial,
          site_id: old.site_id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      newId = a.id;
    }
    const today = ymd(new Date());
    const ents = await tx
      .selectFrom('entitlement')
      .select(['id', 'kind', 'tier', 'starts_on', 'ends_on', 'contract_ref'])
      .where('asset_id', '=', old.id)
      .where(sql<boolean>`ends_on >= ${today}::date`)
      .execute();
    for (const e of ents) {
      await tx
        .insertInto('entitlement')
        .values({
          org_id: r.org_id,
          asset_id: newId,
          kind: e.kind,
          tier: e.tier,
          starts_on: sql`greatest(${e.starts_on}::date, ${today}::date)` as never,
          ends_on: e.ends_on,
          contract_ref: e.contract_ref ? `${e.contract_ref} (${r.number})` : r.number,
        })
        .execute();
      // Coverage on the faulty unit ends today (or never started, if it was future-dated).
      await tx
        .updateTable('entitlement')
        .set({ ends_on: sql`greatest(starts_on, ${today}::date)` as never })
        .where('id', '=', e.id)
        .execute();
    }
    await tx
      .updateTable('asset')
      .set({ retired_at: new Date() })
      .where('id', '=', old.id)
      .execute();
    return newId;
  }

  private async record(
    tx: Tx,
    p: Principal,
    ctx: RequestContext,
    r: { id: string; number: string; org_id: string; case_id: string },
    from: RmaStatus | null,
    to: RmaStatus,
    note: string | null,
  ) {
    await tx
      .insertInto('rma_event')
      .values({
        rma_id: r.id,
        org_id: r.org_id,
        from_status: from,
        to_status: to,
        actor_id: p.userId,
        note,
      })
      .execute();
    await tx
      .insertInto('case_event')
      .values({
        case_id: r.case_id,
        type: 'rma_status',
        visibility: 'public',
        actor_id: p.userId,
        data: JSON.stringify({ rma: r.number, from, to }),
      } as never)
      .execute();
    await emit(tx, 'rma.status_changed', r.org_id, { rmaId: r.id, from, to });
    await audit(
      tx,
      { ...ctx, actorId: p.userId },
      {
        action: from ? 'rma.transition' : 'rma.create',
        orgId: r.org_id,
        targetType: 'rma',
        targetId: r.id,
        diff: { from, to },
      },
    );
  }
}
