/** Portal settings: public contact details and feature switches that the API itself enforces. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, USERS, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(async () => {
  await t.owner.query('DELETE FROM portal_setting');
  await t.close();
});

describe('portal settings', () => {
  it('anyone reads them; only managers and system admins change them', async () => {
    const r = await t.http.get('/api/v1/public/settings').expect(200);
    expect(r.body).toMatchObject({ selfRegistration: true, publicWarrantyCheck: true });
    expect(r.body.p1Phone).toBeTruthy();
    await (await t.as(USERS.kaveriAdmin)).put('/api/v1/admin/settings', r.body).expect(403);
    await (await t.as(USERS.l2)).get('/api/v1/admin/settings').expect(403);
  });

  it('saves new contact details, validates them, and records the change', async () => {
    const m = await t.as(USERS.manager);
    const cur = (await m.get('/api/v1/admin/settings').expect(200)).body;
    const next = { ...cur, p1Phone: '1800 266 9000', businessHours: 'Mon–Fri, 9:30 to 18:30 IST' };
    const r = await m.put('/api/v1/admin/settings', next).expect(200);
    expect(r.body.p1Phone).toBe('1800 266 9000');
    expect((await t.http.get('/api/v1/public/settings').expect(200)).body.businessHours).toBe(
      'Mon–Fri, 9:30 to 18:30 IST',
    );
    await m.put('/api/v1/admin/settings', { ...next, p1Phone: 'call us' }).expect(400);
    await m.put('/api/v1/admin/settings', { ...next, supportEmail: 'nope' }).expect(400);
    const log = await (
      await t.as(USERS.sysadmin)
    )
      .get('/api/v1/audit-log?action=settings.')
      .expect(200);
    expect(JSON.stringify(log.body.items[0].diff)).toContain('1800 266 9000');
  });

  it('switching off registration and the public warranty check closes those endpoints', async () => {
    const m = await t.as(USERS.manager);
    const cur = (await m.get('/api/v1/admin/settings').expect(200)).body;
    await m
      .put('/api/v1/admin/settings', {
        ...cur,
        selfRegistration: false,
        publicWarrantyCheck: false,
      })
      .expect(200);
    const reg = await t.http.post('/api/v1/public/registrations').send({}).expect(403);
    expect(reg.body.detail).toContain('registrations are closed');
    await t.http.post('/api/v1/public/warranty-lookup').send({}).expect(404);
    await m
      .put('/api/v1/admin/settings', { ...cur, selfRegistration: true, publicWarrantyCheck: true })
      .expect(200);
    await t.http.post('/api/v1/public/registrations').send({}).expect(400);
  });
});
