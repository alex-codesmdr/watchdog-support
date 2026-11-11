/**
 * Quick wins: phone-logged cases, low-rating call backs, suggestions beside a case, the management
 * dashboard, the monthly review email, and customer details removed from drafted articles.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MonthlyReviewService } from '../src/modules/insights/monthly-review.service.js';
import { monthStart } from '../src/modules/insights/stats.js';
import { redactCustomer } from '../src/modules/kb/kb.service.js';
import { caseBody, createTestApp, ORG, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(() => t.close());

const open = async (extra: Record<string, unknown> = {}) =>
  (
    await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, extra))
      .expect(201)
  ).body.number as string;

const resolve = async (n: string) => {
  const l2 = await t.as(USERS.l2);
  await l2
    .post(`/api/v1/cases/${n}/messages`, { body: 'Upgrade to 7.1.3 fixes the flapping sessions.' })
    .expect(201);
  await l2.post(`/api/v1/cases/${n}/transition`, { to: 'resolved' }).expect(200);
};

describe('phone call logging', () => {
  it('staff find the caller and open a case timed from the call', async () => {
    const l1 = await t.as(USERS.l1);
    const found = (await l1.get('/api/v1/workspace/callers?q=kaveri').expect(200)).body.items;
    expect(found).toEqual([{ id: ORG.kaveri, name: expect.stringContaining('Kaveri') }]);
    // A serial number finds its owner too.
    expect(
      (await l1.get(`/api/v1/workspace/callers?q=${SERIAL.kaveriPremium}`).expect(200)).body.items,
    ).toHaveLength(1);
    const d = (await l1.get(`/api/v1/workspace/callers/${ORG.kaveri}`).expect(200)).body;
    const caller = d.contacts.find((c: { email: string }) => c.email === USERS.kaveriUser);
    expect(d.devices.map((x: { serialNumber: string }) => x.serialNumber)).toContain(
      SERIAL.kaveriPremium,
    );

    const at = new Date(Date.now() - 20 * 60_000).toISOString();
    const r = await l1
      .post('/api/v1/cases', {
        ...caseBody(SERIAL.kaveriPremium),
        orgId: ORG.kaveri,
        requesterId: caller.id,
        channel: 'phone',
        callStartedAt: at,
      })
      .expect(201);
    const c = (await l1.get(`/api/v1/cases/${r.body.number}`).expect(200)).body;
    expect(c.channel).toBe('phone');
    expect(Date.parse(c.openedAt)).toBe(Date.parse(at));
    expect(c.messages[0].source).toBe('phone');

    // Too long ago, or a customer claiming a phone call: refused.
    await l1
      .post('/api/v1/cases', {
        ...caseBody(SERIAL.kaveriPremium),
        orgId: ORG.kaveri,
        requesterId: caller.id,
        channel: 'phone',
        callStartedAt: new Date(Date.now() - 30 * 3600_000).toISOString(),
      })
      .expect(422);
    await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, { channel: 'phone' }))
      .expect(422);
    await (await t.as(USERS.kaveriAdmin)).get('/api/v1/workspace/callers?q=kaveri').expect(403);
  });
});

describe('low-rating call backs', () => {
  it('a rating of 1 or 2 alerts managers and waits until someone calls back', async () => {
    // Managers receive alerts once they have signed in (active accounts only).
    await (await t.as(USERS.manager)).get('/api/v1/me').expect(200);
    const n = await open();
    await resolve(n);
    const cust = await t.as(USERS.kaveriUser);
    await cust.post(`/api/v1/cases/${n}/csat`, { score: 2, comment: 'Took too long' }).expect(201);
    await t.drainOutbox();
    expect(
      t.mail.sent.some(
        (m) => m.to === USERS.manager && m.subject.startsWith(`[Low rating] ${n} rated 2/5`),
      ),
    ).toBe(true);

    const m = await t.as(USERS.manager);
    const list = (await m.get('/api/v1/workspace/low-ratings').expect(200)).body.items;
    const mine = list.find((x: { caseNumber: string }) => x.caseNumber === n);
    expect(mine).toMatchObject({ score: 2, comment: 'Took too long', status: 'needed' });

    await m
      .post(`/api/v1/workspace/low-ratings/${mine.id}`, {
        note: 'Apologised; agreed a direct line for P2s.',
      })
      .expect(201);
    await m.post(`/api/v1/workspace/low-ratings/${mine.id}`, { note: 'Twice' }).expect(409);
    const after = (await m.get('/api/v1/workspace/low-ratings').expect(200)).body.items;
    expect(after.some((x: { id: string }) => x.id === mine.id)).toBe(false);
    const all = (await m.get('/api/v1/workspace/low-ratings?show=all').expect(200)).body.items;
    expect(all.find((x: { id: string }) => x.id === mine.id)).toMatchObject({
      status: 'done',
      followedUpBy: expect.stringMatching(/Rohan/),
    });
    await (await t.as(USERS.l2)).get('/api/v1/workspace/low-ratings').expect(403);
  });

  it('a good rating needs no call back', async () => {
    const n = await open();
    await resolve(n);
    await (await t.as(USERS.kaveriUser)).post(`/api/v1/cases/${n}/csat`, { score: 5 }).expect(201);
    const all = (await (await t.as(USERS.manager)).get('/api/v1/workspace/low-ratings?show=all'))
      .body.items;
    expect(all.some((x: { caseNumber: string }) => x.caseNumber === n)).toBe(false);
  });
});

describe('suggestions beside a case', () => {
  it('offers similar solved cases with their last reply, to staff only', async () => {
    const solved = await open({ subject: 'OSPF neighbours drop after firmware upgrade' });
    await resolve(solved);
    const n = await open({ subject: 'OSPF neighbours keep dropping since upgrade' });
    const s = (
      await (await t.as(USERS.l1)).get(`/api/v1/workspace/cases/${n}/suggestions`).expect(200)
    ).body;
    const hit = s.cases.find((c: { number: string }) => c.number === solved);
    expect(hit).toMatchObject({ resolution: expect.stringContaining('7.1.3') });
    expect(s.cases.some((c: { number: string }) => c.number === n)).toBe(false);
    expect(Array.isArray(s.articles)).toBe(true);
    await (
      await t.as(USERS.kaveriUser)
    )
      .get(`/api/v1/workspace/cases/${n}/suggestions`)
      .expect(403);
  });
});

describe('management dashboard', () => {
  it('shows six months, the queue now and engineers, to managers', async () => {
    await open();
    const d = (await (await t.as(USERS.manager)).get('/api/v1/workspace/dashboard').expect(200))
      .body;
    expect(d.months).toHaveLength(6);
    expect(d.months[5].month).toBe(monthStart(new Date()));
    expect(d.months[5].opened).toBeGreaterThan(0);
    expect(d.now.openCases).toBeGreaterThan(0);
    expect(d.topCustomers[0].count).toBeGreaterThan(0);
    expect(d.engineers.length).toBeGreaterThan(0);
    await (await t.as(USERS.l1)).get('/api/v1/workspace/dashboard').expect(403);
  });
});

describe('monthly service review', () => {
  it('queues one review per organisation and month, and sends it to customer administrators', async () => {
    await open();
    await (await t.as(USERS.kaveriAdmin)).get('/api/v1/me').expect(200);
    // Pretend it is next month so this month's activity is "last month".
    const next = new Date(Date.now() + 32 * 86400_000);
    const svc = t.app.get(MonthlyReviewService);
    const first = await svc.run(next);
    expect(first.queued).toBeGreaterThan(0);
    expect((await svc.run(next)).queued).toBe(0);
    await t.drainOutbox();
    const mail = t.mail.sent.find(
      (m) =>
        m.to === USERS.kaveriAdmin && m.subject.startsWith('Your WatchDog support summary for'),
    );
    expect(mail?.text).toMatch(/Cases opened: \d+/);
    await t.owner.query(`DELETE FROM monthly_review WHERE month = $1`, [monthStart(new Date())]);
  });
});

describe('articles drafted from cases', () => {
  it('removes customer names, serials, addresses and contact details', () => {
    const out = redactCustomer(
      'Kaveri Cooperative Bank core switch WDSW5600A0001 at 10.20.30.40/24 lost BGP; call Suresh Gowda on +91 98450 12345 or it.admin@kaveribank.example. fe80::1:2:3 too.',
      ['Kaveri Cooperative Bank', 'WDSW5600A0001', 'Suresh Gowda', 'ab'],
    );
    expect(out).toBe(
      '[customer detail] core switch [customer detail] at [IP address] lost BGP; call [customer detail] on [phone number] or [email address]. [IP address] too.',
    );
  });
});
