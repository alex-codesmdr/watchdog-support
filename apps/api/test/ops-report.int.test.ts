/** Phase 4d: operations report and CSV export. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { caseBody, createTestApp, ORG, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
  const k = await t.as(USERS.kaveriUser);
  await k
    .post(
      '/api/v1/cases',
      caseBody(SERIAL.kaveriPremium, { subject: 'Report case one', severity: 'P2' }),
    )
    .expect(201);
  await k
    .post(
      '/api/v1/cases',
      caseBody(SERIAL.kaveriPremium, { subject: '=HYPERLINK("http://x","click")', severity: 'P3' }),
    )
    .expect(201);
  await (
    await t.as(USERS.narmadaUser)
  )
    .post('/api/v1/cases', caseBody(SERIAL.narmadaPremium, { subject: 'Narmada report case' }))
    .expect(201);
});
afterAll(() => t.close());

it('customer admins see only their organisation', async () => {
  const r = await (await t.as(USERS.kaveriAdmin)).get('/api/v1/reports/operations').expect(200);
  expect(r.body.scope).toMatchObject({ orgId: ORG.kaveri });
  expect(r.body.totals.opened).toBeGreaterThanOrEqual(2);
  expect(r.body.topOrganisations).toEqual([]);
  expect(r.body.bySeverity.map((x: { key: string }) => x.key)).toEqual(['P1', 'P2', 'P3', 'P4']);
  expect(r.body.weekly.length).toBeGreaterThanOrEqual(12);
  expect(r.body.backlogAge.reduce((n: number, x: { count: number }) => n + x.count, 0)).toBe(
    r.body.totals.openNow,
  );
  await (
    await t.as(USERS.kaveriAdmin)
  )
    .get(`/api/v1/reports/operations?orgId=${ORG.narmada}`)
    .expect(403);
  await (await t.as(USERS.kaveriUser)).get('/api/v1/reports/operations').expect(403);
  await (await t.as(USERS.l2)).get('/api/v1/reports/operations').expect(403);
});

it('managers see every customer, or one at a time', async () => {
  const all = await (await t.as(USERS.manager)).get('/api/v1/reports/operations').expect(200);
  const k = await (await t.as(USERS.kaveriAdmin)).get('/api/v1/reports/operations').expect(200);
  expect(all.body.totals.opened).toBeGreaterThan(k.body.totals.opened);
  expect(all.body.topOrganisations.map((o: { key: string }) => o.key)).toEqual(
    expect.arrayContaining([ORG.kaveri, ORG.narmada]),
  );
  const one = await (
    await t.as(USERS.manager)
  )
    .get(`/api/v1/reports/operations?orgId=${ORG.narmada}`)
    .expect(200);
  expect(one.body.scope.orgName).toMatch(/Narmada/);
});

it('the CSV export is scoped and safe to open in a spreadsheet', async () => {
  const r = await (
    await t.as(USERS.kaveriAdmin)
  )
    .get('/api/v1/reports/operations/cases.csv')
    .expect(200);
  expect(r.headers['content-type']).toContain('text/csv');
  expect(r.text).toContain('Report case one');
  expect(r.text).not.toContain('Narmada report case');
  expect(r.text).not.toContain('Organisation'); // single-organisation export omits the column
  expect(r.text).toContain(`"'=HYPERLINK(""http://x"",""click"")"`);
  const m = await (
    await t.as(USERS.manager)
  )
    .get('/api/v1/reports/operations/cases.csv')
    .expect(200);
  expect(m.text.split('\r\n')[0]).toContain('Organisation');
  expect(m.text).toContain('Narmada report case');
});
