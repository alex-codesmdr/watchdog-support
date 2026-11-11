/** Engineer visits booked from a case, spare-parts stock at depots, and community answers. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseBody, createTestApp, ORG, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
let managerId: string;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
  for (const u of [USERS.kaveriUser, USERS.kaveriAdmin, USERS.rma, USERS.l2])
    await (await t.as(u)).get('/api/v1/me').expect(200);
  managerId = (await (await t.as(USERS.manager)).get('/api/v1/me')).body.id;
});
afterAll(async () => {
  await t.owner.query(`DELETE FROM oncall_shift WHERE note = 'Visit test'`);
  await t.close();
});

describe('engineer visits', () => {
  it('a customer books a free slot, both sides are emailed, and it can be cancelled', async () => {
    // The manager is on shift 08:00–20:00 IST for the next 12 days.
    await t.owner.query(
      `INSERT INTO oncall_shift (user_id, starts_at, ends_at, note, created_by)
       SELECT $1, (d::date + time '08:00') AT TIME ZONE 'Asia/Kolkata', (d::date + time '20:00') AT TIME ZONE 'Asia/Kolkata', 'Visit test', $1
         FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date + 12, interval '1 day') d`,
      [managerId],
    );
    const cust = await t.as(USERS.kaveriUser);
    const n = (await cust.post('/api/v1/cases', caseBody(SERIAL.kaveriPremium)).expect(201)).body
      .number;
    const slots = (await cust.get(`/api/v1/cases/${n}/visit-slots?kind=onsite`).expect(200)).body;
    expect(slots.days.length).toBeGreaterThan(0);
    const slot = slots.days[0].slots[0];
    // No Sunday is ever offered.
    for (const d of slots.days) expect(new Date(`${d.day}T12:00:00+05:30`).getUTCDay()).not.toBe(0);

    const site = (await cust.get('/api/v1/sites').expect(200)).body.items[0].id;
    const booked = await cust
      .post(`/api/v1/cases/${n}/visits`, {
        kind: 'onsite',
        startsAt: slot.startsAt,
        contactName: 'Lakshmi Nair',
        contactPhone: '+91 98450 12345',
        siteId: site,
      })
      .expect(201);
    const v = booked.body.items[0];
    expect(v).toMatchObject({ status: 'booked', engineerName: 'Rohan I.', kind: 'onsite' });
    await cust
      .post(`/api/v1/cases/${n}/visits`, {
        kind: 'remote',
        startsAt: slot.startsAt,
        contactName: 'Lakshmi Nair',
        contactPhone: '+91 98450 12345',
      })
      .expect(409);
    // The manager is now busy then: another case cannot get the same time.
    const n2 = (await cust.post('/api/v1/cases', caseBody(SERIAL.kaveriPremium)).expect(201)).body
      .number;
    const again = (await cust.get(`/api/v1/cases/${n2}/visit-slots?kind=onsite`)).body;
    expect(
      again.days
        .flatMap((d: { slots: { startsAt: string }[] }) => d.slots)
        .map((s: { startsAt: string }) => s.startsAt),
    ).not.toContain(slot.startsAt);
    // A time that is not on the grid is refused.
    await cust
      .post(`/api/v1/cases/${n2}/visits`, {
        kind: 'remote',
        startsAt: new Date(Date.parse(slot.startsAt) + 17 * 60_000).toISOString(),
        contactName: 'Lakshmi Nair',
        contactPhone: '+91 98450 12345',
      })
      .expect(422);

    await t.drainOutbox();
    const subj = (to: string) =>
      t.mail.sent.find((m) => m.to === to && m.subject.startsWith(`[${n}] Engineer visit booked`));
    expect(subj(USERS.kaveriUser)).toBeTruthy();
    expect(subj(USERS.manager)).toBeTruthy();

    const ics = await cust.get(`/api/v1/visits/${v.id}/calendar.ics`).expect(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('BEGIN:VEVENT');
    await (await t.as(USERS.narmadaUser)).get(`/api/v1/visits/${v.id}/calendar.ics`).expect(404);

    const staffList = (await (await t.as(USERS.l2)).get('/api/v1/workspace/visits').expect(200))
      .body.items;
    expect(staffList.some((x: { id: string }) => x.id === v.id)).toBe(true);

    const c = await cust
      .post(`/api/v1/visits/${v.id}/cancel`, { reason: 'Site closed for an audit' })
      .expect(201);
    expect(c.body.items[0].status).toBe('cancelled');
    await cust.post(`/api/v1/visits/${v.id}/cancel`, { reason: 'Twice' }).expect(409);
    await (await t.as(USERS.kaveriAdmin)).get('/api/v1/workspace/visits').expect(403);
  });
});

describe('spare-parts stock', () => {
  it('coordinators add spares and set minimums; shipping a spare takes it out of stock and warns when low', async () => {
    const r = await t.as(USERS.rma);
    const s0 = (await r.get('/api/v1/workspace/stock').expect(200)).body;
    const noida = s0.depots.find((d: { name: string }) => d.name.startsWith('Noida')).id;
    await r
      .post('/api/v1/workspace/stock/spares', {
        depotId: noida,
        sku: 'WD-AP720',
        serials: ['WDTESTAP0001', 'WDTESTAP0002'],
      })
      .expect(201);
    await r
      .post('/api/v1/workspace/stock/spares', {
        depotId: noida,
        sku: 'WD-AP720',
        serials: ['WDTESTAP0001'],
      })
      .expect(409);
    const s1 = (
      await r
        .put('/api/v1/workspace/stock/levels', { depotId: noida, sku: 'WD-AP720', min: 2 })
        .expect(200)
    ).body;
    const ap = s1.products.find((p: { sku: string }) => p.sku === 'WD-AP720');
    expect(ap.byDepot.find((d: { depotId: string }) => d.depotId === noida)).toMatchObject({
      onHand: 2,
      min: 2,
    });
    await r
      .post('/api/v1/workspace/stock/spares/WDTESTAP0002/write-off', {
        reason: 'Dropped in transit',
      })
      .expect(201);
    await t.drainOutbox();
    expect(
      t.mail.sent.some(
        (m) =>
          m.to === USERS.rma && m.subject.startsWith('Low spare stock: WatchDog AirPack AP720'),
      ),
    ).toBe(true);

    // A dedicated Kaveri firewall with premium cover, so other tests' devices are untouched.
    await t.owner.query(
      `WITH a AS (INSERT INTO asset (org_id, product_id, serial_number) SELECT $1, id, 'WDFWTEST0099' FROM product WHERE sku = 'WD-FW3100' RETURNING id)
       INSERT INTO entitlement (org_id, asset_id, kind, tier, starts_on, ends_on) SELECT $1, id, 'amc', 'premium', current_date - 10, current_date + 300 FROM a`,
      [ORG.kaveri],
    );
    const cust = await t.as(USERS.kaveriUser);
    const n = (await cust.post('/api/v1/cases', caseBody('WDFWTEST0099')).expect(201)).body.number;
    const rma = (
      await cust
        .post(`/api/v1/cases/${n}/rmas`, {
          type: 'advance',
          faultDescription: 'Firewall reboots every hour.',
          contactName: 'Lakshmi Nair',
          contactPhone: '+91 80 4000 1234',
          address: 'Kaveri Bhavan, 12 MG Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        })
        .expect(201)
    ).body.number;
    await r.post(`/api/v1/rmas/${rma}/transition`, { to: 'approved' }).expect(200);
    const avail = (await r.get(`/api/v1/workspace/stock/for-rma/${rma}`).expect(200)).body.depots;
    const spare = avail.find((d: { name: string }) => d.name.startsWith('Noida')).serials[0];
    await r
      .post(`/api/v1/rmas/${rma}/transition`, {
        to: 'replacement_shipped',
        trackingNumber: 'BD12345678',
        replacementSerial: spare,
      })
      .expect(200);
    const after = (await r.get('/api/v1/workspace/stock')).body.products.find(
      (p: { sku: string }) => p.sku === 'WD-FW3100',
    );
    expect(after.byDepot.flatMap((d: { serials: string[] }) => d.serials)).not.toContain(spare);
    await (await t.as(USERS.l1)).get('/api/v1/workspace/stock').expect(403);
  });
});

describe('community answers', () => {
  it('people ask and answer without showing their organisation; the asker marks the answer', async () => {
    const ask = await t.as(USERS.narmadaUser);
    const q = (
      await ask
        .post('/api/v1/community', {
          title: 'Can I stack two SW5600 switches across racks?',
          body: 'We want one logical switch across two racks about 30 metres apart. Which cables work?',
          familyKey: 'switching',
        })
        .expect(201)
    ).body;
    expect(q).toMatchObject({
      author: 'Kavya P.',
      mine: true,
      canAccept: true,
      canModerate: false,
    });
    expect(JSON.stringify(q)).not.toMatch(/Narmada/);

    const other = await t.as(USERS.kaveriUser);
    const a1 = (
      await other
        .post(`/api/v1/community/${q.id}/answers`, {
          body: 'We use 40G optics between racks; works fine.',
        })
        .expect(201)
    ).body;
    const eng = await t.as(USERS.l2);
    const a2 = (
      await eng
        .post(`/api/v1/community/${q.id}/answers`, {
          body: 'Yes: use the 40G stacking ports with SR4 optics up to 100 m.',
        })
        .expect(201)
    ).body;
    const staffAnswer = a2.answerList.find((a: { byStaff: boolean }) => a.byStaff);
    expect(staffAnswer.author).toBe('Vikram R.');
    expect(a1.answerList[0]).toMatchObject({ author: 'Lakshmi N.', byStaff: false });

    // Only the asker or an engineer marks the answer.
    await other.post(`/api/v1/community/${q.id}/accept`, { answerId: staffAnswer.id }).expect(403);
    const done = (
      await ask.post(`/api/v1/community/${q.id}/accept`, { answerId: staffAnswer.id }).expect(201)
    ).body;
    expect(done.solved).toBe(true);
    expect(done.answerList[0]).toMatchObject({ id: staffAnswer.id, accepted: true });

    await t.drainOutbox();
    expect(
      t.mail.sent.some(
        (m) => m.to === USERS.narmadaUser && m.subject.startsWith('New answer to your question'),
      ),
    ).toBe(true);

    const found = (await other.get('/api/v1/community?q=stack%20racks').expect(200)).body.items;
    expect(found[0].id).toBe(q.id);

    // Engineers hide unsuitable posts; customers then no longer see them.
    const bad = a1.answerList.find((a: { byStaff: boolean }) => !a.byStaff);
    await eng
      .post(`/api/v1/community/${q.id}/answers/${bad.id}/hide`, { hidden: true })
      .expect(201);
    const seen = (await ask.get(`/api/v1/community/${q.id}`)).body;
    expect(seen.answerList.some((a: { id: string }) => a.id === bad.id)).toBe(false);
    await other.post(`/api/v1/community/${q.id}/hide`, { hidden: true }).expect(403);
  });
});
