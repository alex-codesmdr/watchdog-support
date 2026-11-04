/**
 * Phase 4a: RMA workflow. Request from a case, coordinator approval, both shipping orders,
 * replacement device and coverage transfer, PDF form, tenant isolation, notifications.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanFingerprints, parseFingerprints } from '@wd/brand-lint';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rmaFormContent } from '../src/modules/rma/rma-form.js';
import { caseBody, createTestApp, ORG, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
let caseNo = '';
let caseNarmada = '';
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
  const k = await (
    await t.as(USERS.kaveriUser)
  )
    .post(
      '/api/v1/cases',
      caseBody(SERIAL.kaveriMissionCritical, { subject: 'PSU failed on core switch' }),
    )
    .expect(201);
  caseNo = k.body.number;
  const n = await (
    await t.as(USERS.narmadaUser)
  )
    .post('/api/v1/cases', caseBody(SERIAL.narmadaPremium, { subject: 'Router fan failure alarm' }))
    .expect(201);
  caseNarmada = n.body.number;
});
afterAll(() => t.close());

const shipTo = {
  contactName: 'Lakshmi Nair',
  contactPhone: '+91 80 4000 1234',
  address: 'Kaveri Bhavan, 12 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};
const move = async (who: string, rma: string, body: object, status = 200) =>
  (await t.as(who)).post(`/api/v1/rmas/${rma}/transition`, body).expect(status);

describe('standard RMA: return, then replace', () => {
  let rma = '';
  let oldAssetId = '';

  it('the customer requests a replacement from the case; coordinators are alerted', async () => {
    const before = t.mail.sent.length;
    const r = await (
      await t.as(USERS.kaveriUser)
    )
      .post(`/api/v1/cases/${caseNo}/rmas`, {
        ...shipTo,
        faultDescription: 'PSU 2 fault LED on, switch reboots under load.',
      })
      .expect(201);
    rma = r.body.number;
    expect(rma).toMatch(/^RMA-\d{4}-\d{6}$/);
    expect(r.body).toMatchObject({ status: 'requested', type: 'standard', next: ['cancelled'] });
    oldAssetId = (await t.owner.query(`SELECT asset_id FROM rma WHERE number = $1`, [rma])).rows[0]
      .asset_id;
    await t.drainOutbox();
    const mails = t.mail.sent.slice(before);
    expect(
      mails.some((m) => m.to === 'arjun.rma@watchdog.example' && m.subject.includes(rma)),
    ).toBe(true);
    expect(mails.some((m) => m.to === USERS.kaveriUser && m.subject === `[${rma}] Requested`)).toBe(
      true,
    );
  });

  it('only one open RMA per device; the case shows the RMA', async () => {
    await (
      await t.as(USERS.kaveriUser)
    )
      .post(`/api/v1/cases/${caseNo}/rmas`, {
        ...shipTo,
        faultDescription: 'Duplicate request text',
      })
      .expect(409);
    const c = await (await t.as(USERS.kaveriUser)).get(`/api/v1/cases/${caseNo}`).expect(200);
    expect(JSON.stringify(c.body.events)).toContain(rma);
  });

  it('customers cannot approve; the coordinator approves', async () => {
    await move(USERS.kaveriUser, rma, { to: 'approved' }, 409);
    const r = await move(USERS.rma, rma, { to: 'approved' });
    expect(r.body.next).toEqual(['return_in_transit', 'cancelled']);
  });

  it('the customer downloads a brand-clean PDF form and ships the faulty unit', async () => {
    const pdf = await (
      await t.as(USERS.kaveriUser)
    )
      .get(`/api/v1/rmas/${rma}/form.pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const b: Buffer[] = [];
        res.on('data', (c: Buffer) => b.push(c));
        res.on('end', () => cb(null, Buffer.concat(b)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const view = (await (await t.as(USERS.kaveriUser)).get(`/api/v1/rmas/${rma}`).expect(200)).body;
    const content = JSON.stringify(rmaFormContent(view, 'WatchDog Returns Centre'));
    expect(content).toContain(SERIAL.kaveriMissionCritical);
    const fp = parseFingerprints(
      readFileSync(
        fileURLToPath(new URL('../../../packages/brand-lint/prohibited.sha256', import.meta.url)),
        'utf8',
      ),
    );
    expect(scanFingerprints(content, fp)).toEqual([]);
    expect(content).not.toMatch(/OEM-REF/);

    await move(USERS.kaveriUser, rma, { to: 'return_in_transit' }, 422); // tracking number needed
    const r = await move(USERS.kaveriUser, rma, {
      to: 'return_in_transit',
      courier: 'Blue Dart',
      trackingNumber: 'BD12345678',
    });
    expect(r.body.inbound).toEqual({ courier: 'Blue Dart', trackingNumber: 'BD12345678' });
  });

  it('receipt, then replacement: coverage moves to the new serial and the old unit retires', async () => {
    await move(USERS.rma, rma, { to: 'received' });
    await move(USERS.rma, rma, { to: 'replacement_shipped', trackingNumber: 'BD99887766' }, 422);
    const before = t.mail.sent.length;
    const r = await move(USERS.rma, rma, {
      to: 'replacement_shipped',
      courier: 'Blue Dart',
      trackingNumber: 'BD99887766',
      replacementSerial: 'WDSW5600R0001',
    });
    expect(r.body).toMatchObject({
      status: 'replacement_shipped',
      replacementSerial: 'WDSW5600R0001',
      next: ['closed'],
    });

    const assets = (await (await t.as(USERS.kaveriUser)).get('/api/v1/assets').expect(200)).body
      .items as Array<{
      serialNumber: string;
      entitlement: { tier: string } | null;
    }>;
    expect(assets.find((a) => a.serialNumber === SERIAL.kaveriMissionCritical)).toBeUndefined();
    expect(assets.find((a) => a.serialNumber === 'WDSW5600R0001')?.entitlement?.tier).toBe(
      'mission_critical',
    );
    const old = await t.owner.query(`SELECT retired_at FROM asset WHERE id = $1`, [oldAssetId]);
    expect(old.rows[0].retired_at).not.toBeNull();

    await t.drainOutbox();
    const mail = t.mail.sent
      .slice(before)
      .find((m) => m.to === USERS.kaveriUser && m.subject.includes('Replacement shipped'));
    expect(mail?.text).toContain('BD99887766');
    expect(mail?.text).toContain('WDSW5600R0001');
    await move(USERS.rma, rma, { to: 'closed' });
  });
});

describe('advance replacement and guards', () => {
  it('advance replacement needs Premium or Mission-Critical coverage', async () => {
    // Narmada's router has Premium coverage: allowed.
    const r = await (
      await t.as(USERS.narmadaUser)
    )
      .post(`/api/v1/cases/${caseNarmada}/rmas`, {
        ...shipTo,
        type: 'advance',
        faultDescription: 'Fan tray failure, chassis overheating.',
      })
      .expect(201);
    await move(USERS.rma, r.body.number, { to: 'approved' });
    // Ship first, then the customer returns the faulty unit.
    await move(USERS.rma, r.body.number, {
      to: 'replacement_shipped',
      trackingNumber: 'DL55500011',
      replacementSerial: 'WDRT8800R0002',
    });
    const v = await move(USERS.narmadaUser, r.body.number, {
      to: 'return_in_transit',
      trackingNumber: 'DL55500012',
    });
    expect(v.body.next).toEqual([]);
    await move(USERS.rma, r.body.number, { to: 'received' });
    const done = await move(USERS.rma, r.body.number, { to: 'closed' });
    expect(done.body.events.map((e: { to: string }) => e.to)).toEqual([
      'requested',
      'approved',
      'replacement_shipped',
      'return_in_transit',
      'received',
      'closed',
    ]);
  });

  it('another organisation cannot see, request on, or move the RMA', async () => {
    const list = await (await t.as(USERS.narmadaAdmin)).get('/api/v1/rmas').expect(200);
    expect(list.body.items.every((x: { org: { id: string } }) => x.org.id === ORG.narmada)).toBe(
      true,
    );
    const k = (await (await t.as(USERS.kaveriAdmin)).get('/api/v1/rmas').expect(200)).body.items[0];
    await (await t.as(USERS.narmadaAdmin)).get(`/api/v1/rmas/${k.number}`).expect(404);
    await (await t.as(USERS.narmadaAdmin)).get(`/api/v1/rmas/${k.number}/form.pdf`).expect(404);
    await move(USERS.narmadaAdmin, k.number, { to: 'cancelled' }, 404);
    await (
      await t.as(USERS.narmadaUser)
    )
      .post(`/api/v1/cases/${caseNo}/rmas`, { ...shipTo, faultDescription: 'Not my case at all' })
      .expect(404);
  });

  it('a replacement serial that belongs to another customer is refused', async () => {
    const c = await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, { subject: 'Firewall port dead' }))
      .expect(201);
    const r = await (
      await t.as(USERS.rma)
    )
      .post(`/api/v1/cases/${c.body.number}/rmas`, {
        ...shipTo,
        faultDescription: 'Port 3 has no link at all.',
      })
      .expect(201);
    expect(r.body.status).toBe('approved'); // coordinator-created RMAs start approved
    await move(USERS.rma, r.body.number, { to: 'return_in_transit', trackingNumber: 'XX1234' });
    await move(USERS.rma, r.body.number, { to: 'received' });
    await move(
      USERS.rma,
      r.body.number,
      {
        to: 'replacement_shipped',
        trackingNumber: 'XX9999',
        replacementSerial: SERIAL.narmadaPremium,
      },
      422,
    );
  });

  it('engineers without RMA rights cannot approve; L1 cannot request', async () => {
    // The case's original router was replaced above, so the RMA names the new unit explicitly.
    const assetId = (
      await t.owner.query(`SELECT id FROM asset WHERE serial_number = 'WDRT8800R0002'`)
    ).rows[0].id;
    const r = await (
      await t.as(USERS.l2)
    )
      .post(`/api/v1/cases/${caseNarmada}/rmas`, {
        ...shipTo,
        assetId,
        faultDescription: 'Second fan tray also failed today.',
      })
      .expect(201);
    expect(r.body).toMatchObject({ status: 'requested', next: [] });
    await move(USERS.l2, r.body.number, { to: 'approved' }, 409);
    await move(USERS.rma, r.body.number, { to: 'rejected' }, 422);
    await move(USERS.rma, r.body.number, { to: 'rejected', note: 'Duplicate of the earlier RMA' });
    await (await t.as(USERS.l1)).get('/api/v1/rmas').expect(403);
  });
});
