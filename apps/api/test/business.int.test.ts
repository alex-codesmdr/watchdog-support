/**
 * Contracts and invoices, the renewal pipeline and weekly digest, partner access, the on-call
 * roster, product lifecycle notices and the feature request board.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RenewalDigestService } from '../src/modules/business/renewal-digest.service.js';
import { caseBody, createTestApp, ORG, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
  // Recipients of emails must have signed in once (active accounts).
  for (const u of [USERS.kaveriAdmin, USERS.narmadaAdmin, USERS.manager])
    await (await t.as(u)).get('/api/v1/me').expect(200);
});
afterAll(() => t.close());

describe('contracts and invoices', () => {
  it('customer administrators see their contracts, devices and invoices; nobody else does', async () => {
    const a = await t.as(USERS.narmadaAdmin);
    const items = (await a.get('/api/v1/contracts').expect(200)).body.items;
    expect(items).toHaveLength(1);
    const c = items[0];
    expect(c).toMatchObject({
      ref: 'NSCA-AMC-ICC',
      valueInr: 1250000,
      owner: null,
      renewalStage: null,
    });
    expect(c.devices.map((d: { serialNumber: string }) => d.serialNumber)).toContain(
      SERIAL.narmadaPremium,
    );
    // The unpaid invoice is past its due date.
    expect(c.invoices.find((i: { status: string }) => i.status === 'overdue')).toBeTruthy();
    await (await t.as(USERS.narmadaUser)).get('/api/v1/contracts').expect(403);
    // A partner acting for Narmada sees cases and devices, never money.
    await (await t.as(USERS.partner)).get('/api/v1/contracts').expect(403);
    await (await t.as(USERS.l2)).get('/api/v1/contracts').expect(403);
  });

  it('a customer asks to renew a contract once; sales and the account owner hear about it', async () => {
    const a = await t.as(USERS.kaveriAdmin);
    const c = (await a.get('/api/v1/contracts').expect(200)).body.items.find(
      (x: { ref: string }) => x.ref === 'KCB-WTY-EDGE',
    );
    const r = await a
      .post(`/api/v1/contracts/${c.id}/renewal-request`, { note: 'Please quote 3 years' })
      .expect(201);
    expect(r.body.items.find((x: { id: string }) => x.id === c.id).renewalRequested).toBe(true);
    await a.post(`/api/v1/contracts/${c.id}/renewal-request`, {}).expect(409);
    await t.drainOutbox();
    const mails = t.mail.sent.filter(
      (m) => m.subject === '[Renewal] Kaveri Cooperative Bank (Demo) – contract KCB-WTY-EDGE',
    );
    expect(mails.map((m) => m.to)).toContain(USERS.manager);
    expect(mails[0]!.text).toContain('Please quote 3 years');
    // Another organisation's contract is invisible.
    const other = (await (await t.as(USERS.narmadaAdmin)).get('/api/v1/contracts')).body.items[0];
    await a.post(`/api/v1/contracts/${other.id}/renewal-request`, {}).expect(404);
  });

  it('staff record contracts and invoices and mark them paid', async () => {
    const m = await t.as(USERS.manager);
    const created = await m
      .post('/api/v1/admin/contracts', {
        orgId: ORG.kaveri,
        ref: 'KCB-TEST-01',
        title: 'Test contract',
        valueInr: 50000,
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
      })
      .expect(201);
    await m
      .post('/api/v1/admin/contracts', {
        orgId: ORG.kaveri,
        ref: 'KCB-TEST-01',
        title: 'Duplicate',
        valueInr: 1,
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
      })
      .expect(409);
    const withInv = await m
      .post(`/api/v1/admin/contracts/${created.body.id}/invoices`, {
        number: `T-${Date.now()}`,
        issuedOn: '2026-01-01',
        dueOn: '2026-01-31',
        amountInr: 50000,
      })
      .expect(201);
    const inv = withInv.body.invoices[0];
    expect(inv.status).toBe('overdue');
    const paid = await m
      .post(`/api/v1/admin/invoices/${inv.id}`, { status: 'paid', paidOn: '2026-02-03' })
      .expect(201);
    expect(paid.body.invoices[0]).toMatchObject({ status: 'paid', paidOn: '2026-02-03' });
    await m.post(`/api/v1/admin/invoices/${inv.id}`, { status: 'cancelled' }).expect(409);
    await (await t.as(USERS.l1)).get('/api/v1/admin/contracts').expect(403);
  });
});

describe('renewal pipeline', () => {
  it('lists what ends soon with value and stage; moving the stage closes the customer request', async () => {
    const m = await t.as(USERS.manager);
    const p = (await m.get('/api/v1/workspace/renewals?days=365').expect(200)).body;
    const edge = p.items.find((i: { ref: string | null }) => i.ref === 'KCB-WTY-EDGE');
    expect(edge).toMatchObject({ valueInr: 96000, ownerName: expect.stringMatching(/Rohan/) });
    expect(p.totals.openValueInr).toBeGreaterThan(0);
    await m
      .put(`/api/v1/workspace/renewals/${edge.contractId}`, {
        stage: 'quoted',
        note: 'Sent 3-year quote',
      })
      .expect(200);
    const again = (await m.get('/api/v1/workspace/renewals?days=365')).body.items.find(
      (i: { ref: string | null }) => i.ref === 'KCB-WTY-EDGE',
    );
    expect(again).toMatchObject({
      stage: 'quoted',
      note: 'Sent 3-year quote',
      customerAsked: false,
    });
  });

  it('sends each account owner one digest a week', async () => {
    const svc = t.app.get(RenewalDigestService);
    const now = new Date();
    const first = await svc.run(now);
    expect(first.queued).toBeGreaterThan(0);
    expect((await svc.run(now)).queued).toBe(0);
    await t.drainOutbox();
    expect(
      t.mail.sent.some(
        (m) => m.to === USERS.manager && m.subject.startsWith('Renewals this week:'),
      ),
    ).toBe(true);
  });
});

describe('partner access', () => {
  it('staff give a partner access, the customer is told and can end it', async () => {
    const m = await t.as(USERS.manager);
    const o = (await m.get('/api/v1/admin/partners').expect(200)).body;
    const sahyadri = o.partners.find((x: { name: string }) => x.name.startsWith('Sahyadri')).id;
    await m
      .post('/api/v1/admin/partners/delegations', {
        partnerOrgId: sahyadri,
        customerOrgId: ORG.kaveri,
      })
      .expect(201);
    await m
      .post('/api/v1/admin/partners/delegations', {
        partnerOrgId: sahyadri,
        customerOrgId: ORG.kaveri,
      })
      .expect(409);
    await t.drainOutbox();
    expect(
      t.mail.sent.some(
        (x) => x.to === USERS.kaveriAdmin && x.subject.includes('can now handle WatchDog support'),
      ),
    ).toBe(true);

    const partner = await t.as(USERS.partner);
    const custs = (await partner.get('/api/v1/partner/customers').expect(200)).body.items;
    expect(custs.map((c: { id: string }) => c.id)).toEqual(
      expect.arrayContaining([ORG.kaveri, ORG.narmada]),
    );

    const a = await t.as(USERS.kaveriAdmin);
    const mine = (await a.get('/api/v1/org/partners').expect(200)).body.items;
    expect(mine).toHaveLength(1);
    await a.post(`/api/v1/org/partners/${mine[0].id}/revoke`).expect(201);
    expect((await a.get('/api/v1/org/partners')).body.items).toHaveLength(0);
    const after = (await partner.get('/api/v1/partner/customers')).body.items;
    expect(after.map((c: { id: string }) => c.id)).not.toContain(ORG.kaveri);
    // Narmada cannot end Kaveri's partners, nor staff-only management.
    await (await t.as(USERS.narmadaAdmin)).get('/api/v1/admin/partners').expect(403);
  });
});

describe('on-call roster', () => {
  it('a P1 no rule picks up goes to the P1 on-call engineer, who is emailed', async () => {
    const m = await t.as(USERS.manager);
    const me = (await m.get('/api/v1/me')).body;
    const now = Date.now();
    await m
      .post('/api/v1/admin/roster', {
        userId: me.id,
        startsAt: new Date(now - 60_000).toISOString(),
        endsAt: new Date(now + 10 * 60_000).toISOString(),
        p1: true,
        note: 'Test duty',
      })
      .expect(201);
    try {
      const r = await (
        await t.as(USERS.kaveriUser)
      )
        .post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, { severity: 'P1' }))
        .expect(201);
      const c = (await m.get(`/api/v1/cases/${r.body.number}`).expect(200)).body;
      expect(c.assigneeId).toBe(me.id);
      await t.drainOutbox();
      expect(
        t.mail.sent.some(
          (x) =>
            x.to === USERS.manager &&
            x.subject === `[P1] ${r.body.number} – Kaveri Cooperative Bank (Demo)`,
        ),
      ).toBe(true);
      const roster = (await (await t.as(USERS.l1)).get('/api/v1/workspace/roster').expect(200))
        .body;
      expect(roster.onShiftNow).toContainEqual(expect.objectContaining({ p1: true }));
    } finally {
      const roster = (await m.get('/api/v1/workspace/roster')).body;
      for (const s of roster.shifts.filter((x: { note: string | null }) => x.note === 'Test duty'))
        await m.delete(`/api/v1/admin/roster/${s.id}`).expect(204);
    }
    await (await t.as(USERS.l1)).post('/api/v1/admin/roster', {}).expect(403);
  });
});

describe('product lifecycle', () => {
  it('staff set dates and advice; owners see it beside their devices and are emailed', async () => {
    const e = await t.as(USERS.content);
    const list = (await e.get('/api/v1/admin/products').expect(200)).body.items;
    const fw = list.find((x: { sku: string }) => x.sku === 'WD-FW3100');
    await e
      .put(`/api/v1/admin/products/${fw.id}/lifecycle`, {
        lifecycle: 'eos_announced',
        endOfSale: '2027-03-31',
        endOfSupport: '2030-03-31',
        replacementSku: 'WD-SDW-3400',
        advice: 'Move to the SDW-3400 for built-in SD-WAN.',
        notify: true,
      })
      .expect(200);
    await t.drainOutbox();
    expect(
      t.mail.sent.some(
        (x) =>
          x.to === USERS.kaveriAdmin &&
          x.subject === 'End-of-life notice: WatchDog Sentinel FW3100',
      ),
    ).toBe(true);
    const devices = (await (await t.as(USERS.kaveriUser)).get('/api/v1/assets').expect(200)).body
      .items;
    expect(
      devices.find((d: { serialNumber: string }) => d.serialNumber === SERIAL.kaveriPremium)
        .lifecycle,
    ).toEqual({
      stage: 'eos_announced',
      endOfSale: '2027-03-31',
      endOfSupport: '2030-03-31',
      advice: 'Move to the SDW-3400 for built-in SD-WAN.',
      replacement: 'WatchDog EdgeGuard SDW-3400',
    });
    await e
      .put(`/api/v1/admin/products/${fw.id}/lifecycle`, {
        lifecycle: 'ga',
        endOfSale: null,
        endOfSupport: null,
        replacementSku: null,
        advice: null,
      })
      .expect(200);
    await (await t.as(USERS.l2)).get('/api/v1/admin/products').expect(403);
  });
});

describe('feature request board', () => {
  it('customers post and vote without seeing who posted; staff respond and hide', async () => {
    const k = await t.as(USERS.kaveriUser);
    const posted = await k
      .post('/api/v1/ideas', {
        title: 'Export the case list to a spreadsheet',
        body: 'Our auditors ask for a list of all cases each quarter.',
        familyKey: 'switching',
      })
      .expect(201);
    expect(posted.body).toMatchObject({ votes: 1, votedByMe: true, mine: true, postedBy: null });

    const n = await t.as(USERS.narmadaUser);
    const seen = (await n.get('/api/v1/ideas?sort=new').expect(200)).body.items.find(
      (i: { id: string }) => i.id === posted.body.id,
    );
    expect(seen).toMatchObject({ mine: false, postedBy: null, votedByMe: false });
    expect(JSON.stringify(seen)).not.toMatch(/Kaveri|Lakshmi/);
    expect((await n.post(`/api/v1/ideas/${posted.body.id}/vote`).expect(201)).body.votes).toBe(2);
    expect((await n.post(`/api/v1/ideas/${posted.body.id}/vote`).expect(201)).body.votes).toBe(2);
    expect((await n.delete(`/api/v1/ideas/${posted.body.id}/vote`).expect(200)).body.votes).toBe(1);

    const m = await t.as(USERS.manager);
    const staffView = (await m.get('/api/v1/ideas?sort=new')).body.items.find(
      (i: { id: string }) => i.id === posted.body.id,
    );
    expect(staffView.postedBy).toMatch(/Kaveri/);
    await m
      .put(`/api/v1/ideas/${posted.body.id}`, {
        status: 'planned',
        response: 'Coming next quarter.',
      })
      .expect(200);
    await m
      .put(`/api/v1/ideas/${posted.body.id}`, { status: 'declined', hidden: true })
      .expect(200);
    const hidden = (await n.get('/api/v1/ideas')).body.items.some(
      (i: { id: string }) => i.id === posted.body.id,
    );
    expect(hidden).toBe(false);
    // The author still sees their own.
    expect(
      (await k.get('/api/v1/ideas')).body.items.some(
        (i: { id: string }) => i.id === posted.body.id,
      ),
    ).toBe(true);
    await k.put(`/api/v1/ideas/${posted.body.id}`, { status: 'done' }).expect(403);
    await (
      await t.as(USERS.l1)
    )
      .post('/api/v1/ideas', { title: 'Staff idea here', body: 'Staff cannot post.' })
      .expect(403);
  });
});
