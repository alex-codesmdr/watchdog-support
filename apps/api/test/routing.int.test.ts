/**
 * Automatic routing: the first enabled matching rule sets the queue and assigns the least busy of
 * its engineers when a customer opens a case. Customers never see the rules or the routing events.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseBody, createTestApp, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(async () => {
  // Leave no rules behind for other test files.
  await t.owner.query('DELETE FROM routing_rule');
  await t.close();
});

/** Every rule here is limited to licensing cases, which no other test file opens (they run in parallel). */
const ONLY = { categories: ['licensing'] };
const id = async (email: string) =>
  (await (await t.as(email)).get('/api/v1/me').expect(200)).body.id as string;

describe('routing rules', () => {
  it('only support managers and system administrators manage rules', async () => {
    await (await t.as(USERS.l2)).get('/api/v1/admin/routing/rules').expect(403);
    await (await t.as(USERS.kaveriAdmin)).get('/api/v1/admin/routing/rules').expect(403);
    const o = await (await t.as(USERS.manager)).get('/api/v1/admin/routing/options').expect(200);
    expect(o.body.queues.length).toBeGreaterThan(0);
    expect(o.body.engineers.length).toBeGreaterThan(0);
    expect(o.body.families.map((f: { name: string }) => f.name)).toContain('Switching');
  });

  it('routes a matching case to the least busy engineer; first match wins; disabled rules are skipped', async () => {
    const m = await t.as(USERS.manager);
    const opts = (await m.get('/api/v1/admin/routing/options').expect(200)).body;
    const switching = opts.families.find((f: { name: string }) => f.name === 'Switching').id;
    const security = opts.families.find((f: { name: string }) => f.name === 'Security').id;
    const l2q = opts.queues.find((q: { name: string }) => q.name.startsWith('L2')).id;
    const [l2, l3, l1] = [await id(USERS.l2), await id(USERS.l3), await id(USERS.l1)];

    const off = await m
      .post('/api/v1/admin/routing/rules', {
        ...ONLY,
        name: 'Disabled catch-all',
        enabled: false,
        assigneeIds: [l1],
      })
      .expect(201);
    const sw = await m
      .post('/api/v1/admin/routing/rules', {
        ...ONLY,
        name: 'Critical switching',
        severities: ['P1', 'P2'],
        familyIds: [switching],
        queueId: l2q,
        assigneeIds: [l2, l3],
      })
      .expect(201);
    await m
      .post('/api/v1/admin/routing/rules', {
        ...ONLY,
        name: 'Security to L3',
        familyIds: [security],
        assigneeIds: [l3],
      })
      .expect(201);
    // Put the disabled rule first: it must still be skipped.
    const all = (await m.get('/api/v1/admin/routing/rules').expect(200)).body.items as {
      id: string;
    }[];
    await m
      .put('/api/v1/admin/routing/order', {
        ids: [off.body.id, ...all.filter((r) => r.id !== off.body.id).map((r) => r.id)],
      })
      .expect(200);

    const cust = await t.as(USERS.kaveriUser);
    const loadBefore = (await m.get('/api/v1/admin/routing/options').expect(200)).body
      .engineers as {
      id: string;
      openCases: number;
    }[];
    const least = [l2, l3].sort(
      (a, b) =>
        loadBefore.find((e) => e.id === a)!.openCases -
        loadBefore.find((e) => e.id === b)!.openCases,
    )[0];
    const c1 = await cust
      .post(
        '/api/v1/cases',
        caseBody(SERIAL.kaveriMissionCritical, { severity: 'P1', category: 'licensing' }),
      )
      .expect(201);
    const d1 = (await m.get(`/api/v1/cases/${c1.body.number}`).expect(200)).body;
    expect([l2, l3]).toContain(d1.assigneeId);
    if (
      loadBefore.find((e) => e.id === l2)!.openCases !==
      loadBefore.find((e) => e.id === l3)!.openCases
    )
      expect(d1.assigneeId).toBe(least);
    expect(d1.events.some((e: { type: string }) => e.type === 'routed')).toBe(true);

    // The customer does not see routing details.
    const seen = (await cust.get(`/api/v1/cases/${c1.body.number}`).expect(200)).body;
    expect(seen.events.some((e: { type: string }) => e.type === 'routed')).toBe(false);
    expect(JSON.stringify(seen)).not.toContain('Critical switching');

    // A P4 on the same switch matches nothing; the firewall goes to L3.
    const c2 = await cust
      .post(
        '/api/v1/cases',
        caseBody(SERIAL.kaveriMissionCritical, { severity: 'P4', category: 'licensing' }),
      )
      .expect(201);
    expect((await m.get(`/api/v1/cases/${c2.body.number}`).expect(200)).body.assigneeId).toBeNull();
    const c3 = await cust
      .post(
        '/api/v1/cases',
        caseBody(SERIAL.kaveriPremium, { severity: 'P3', category: 'licensing' }),
      )
      .expect(201);
    expect((await m.get(`/api/v1/cases/${c3.body.number}`).expect(200)).body.assigneeId).toBe(l3);

    await m.delete(`/api/v1/admin/routing/rules/${sw.body.id}`).expect(204);
  });

  it('rejects rules that do nothing or assign to non-engineers', async () => {
    const m = await t.as(USERS.manager);
    await m.post('/api/v1/admin/routing/rules', { ...ONLY, name: 'No action' }).expect(422);
    const cust = await id(USERS.kaveriAdmin);
    await m
      .post('/api/v1/admin/routing/rules', { ...ONLY, name: 'To a customer', assigneeIds: [cust] })
      .expect(422);
    await m
      .post('/api/v1/admin/routing/rules', {
        name: 'Bad severity',
        severities: ['P9'],
        assigneeIds: [],
      })
      .expect(400);
    await m.put('/api/v1/admin/routing/order', { ids: [cust] }).expect(422);
  });
});
