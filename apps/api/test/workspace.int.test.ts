/** Engineer workspace: bulk assignment, presence, customer context, time logging, saved views. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseBody, createTestApp, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(() => t.close());

const open = async () =>
  (
    await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriPremium))
      .expect(201)
  ).body.number as string;

describe('engineer workspace', () => {
  it('bulk-assigns cases, reporting each one, and records them like single assignments', async () => {
    const [a, b] = [await open(), await open()];
    // Engineers count as active once they have signed in.
    await (await t.as(USERS.l2)).get('/api/v1/me').expect(200);
    const m = await t.as(USERS.manager);
    const eng = (await m.get('/api/v1/workspace/engineers').expect(200)).body.items as {
      id: string;
      name: string;
    }[];
    const l2 = eng.find((e) => e.name.startsWith('Vikram'))!;
    const r = await m
      .post('/api/v1/workspace/bulk-assign', {
        numbers: [a, b, 'WD-2000-999999'],
        assigneeId: l2.id,
      })
      .expect(200);
    expect(r.body.results).toEqual([
      { number: a, ok: true, error: null },
      { number: b, ok: true, error: null },
      { number: 'WD-2000-999999', ok: false, error: expect.any(String) },
    ]);
    expect((await m.get(`/api/v1/cases/${a}`).expect(200)).body.assigneeId).toBe(l2.id);
    await (
      await t.as(USERS.l1)
    )
      .post('/api/v1/workspace/bulk-assign', { numbers: [a], assigneeId: null })
      .expect(200);
    await (await t.as(USERS.kaveriAdmin)).get('/api/v1/workspace/engineers').expect(403);
  });

  it('tells an engineer who else has the case open, and whether they are replying', async () => {
    const n = await open();
    const l1 = await t.as(USERS.l1);
    const l2 = await t.as(USERS.l2);
    expect(
      (await l1.post(`/api/v1/workspace/cases/${n}/presence`, {}).expect(200)).body.others,
    ).toEqual([]);
    await l2.post(`/api/v1/workspace/cases/${n}/presence`, { replying: true }).expect(200);
    const seen = (await l1.post(`/api/v1/workspace/cases/${n}/presence`, {}).expect(200)).body
      .others;
    expect(seen).toEqual([{ name: expect.stringMatching(/Vikram/), replying: true }]);
    await (
      await t.as(USERS.kaveriUser)
    )
      .post(`/api/v1/workspace/cases/${n}/presence`, {})
      .expect(403);
  });

  it('shows the customer at a glance, to staff only', async () => {
    const n = await open();
    const c = (await (await t.as(USERS.l2)).get(`/api/v1/workspace/cases/${n}/context`).expect(200))
      .body;
    expect(c.orgName).toContain('Kaveri');
    expect(c.openCases).toBeGreaterThan(0);
    expect(c.devices).toBeGreaterThan(0);
    expect(c.recentCases.every((r: { number: string }) => r.number !== n)).toBe(true);
    await (await t.as(USERS.kaveriAdmin)).get(`/api/v1/workspace/cases/${n}/context`).expect(403);
  });

  it('logs time on a case; engineers delete only their own entries; customers see nothing', async () => {
    const n = await open();
    const l1 = await t.as(USERS.l1);
    const r = await l1
      .post(`/api/v1/workspace/cases/${n}/time`, { minutes: 45, note: 'Reviewed logs' })
      .expect(201);
    expect(r.body.totalMinutes).toBe(45);
    const l2 = await t.as(USERS.l2);
    const r2 = await l2.post(`/api/v1/workspace/cases/${n}/time`, { minutes: 30 }).expect(201);
    expect(r2.body.totalMinutes).toBe(75);
    const theirs = r2.body.entries.find((e: { mine: boolean }) => !e.mine).id;
    await l2.delete(`/api/v1/workspace/time/${theirs}`).expect(404);
    await l1.post(`/api/v1/workspace/cases/${n}/time`, { minutes: 0 }).expect(400);
    await l1.post(`/api/v1/workspace/cases/${n}/time`, { minutes: 2000 }).expect(400);
    const cust = await t.as(USERS.kaveriUser);
    await cust.get(`/api/v1/workspace/cases/${n}/time`).expect(403);
    expect(JSON.stringify((await cust.get(`/api/v1/cases/${n}`).expect(200)).body)).not.toContain(
      'Reviewed logs',
    );
  });

  it('saves personal queue views', async () => {
    const l1 = await t.as(USERS.l1);
    const v = await l1
      .post('/api/v1/workspace/views', {
        name: 'My P1s',
        params: { view: 'assigned', severity: 'P1' },
      })
      .expect(201);
    expect(
      (await l1.get('/api/v1/workspace/views').expect(200)).body.items.map(
        (x: { name: string }) => x.name,
      ),
    ).toContain('My P1s');
    expect(
      (await (await t.as(USERS.l2)).get('/api/v1/workspace/views').expect(200)).body.items.map(
        (x: { name: string }) => x.name,
      ),
    ).not.toContain('My P1s');
    await (await t.as(USERS.l2)).delete(`/api/v1/workspace/views/${v.body.id}`).expect(404);
    await l1.delete(`/api/v1/workspace/views/${v.body.id}`).expect(204);
  });
});
