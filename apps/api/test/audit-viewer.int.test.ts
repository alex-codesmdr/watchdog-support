/** Phase 4d: audit-trail viewer, tamper check and export. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { caseBody, createTestApp, ORG, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
let caseNo = '';
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
  const c = await (
    await t.as(USERS.kaveriUser)
  )
    .post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, { subject: 'Audit viewer case' }))
    .expect(201);
  caseNo = c.body.number;
  // A staff action on Kaveri's case, with change detail.
  await (
    await t.as(USERS.l2)
  )
    .post(`/api/v1/cases/${caseNo}/transition`, { to: 'in_progress' })
    .expect(200);
  await (
    await t.as(USERS.l2)
  )
    .post(`/api/v1/cases/${caseNo}/messages`, {
      visibility: 'internal',
      body: 'Staff-only triage note',
    })
    .expect(201);
  await (
    await t.as(USERS.narmadaUser)
  )
    .post('/api/v1/cases', caseBody(SERIAL.narmadaPremium, { subject: 'Narmada audit case' }))
    .expect(201);
});
afterAll(() => t.close());

it('staff see every organisation with full detail, filters and paging', async () => {
  const m = await t.as(USERS.manager);
  const all = await m.get('/api/v1/audit-log').expect(200);
  const orgs = new Set(all.body.items.map((e: { orgName: string | null }) => e.orgName));
  expect([...orgs].some((o) => String(o).includes('Kaveri'))).toBe(true);
  expect([...orgs].some((o) => String(o).includes('Narmada'))).toBe(true);
  const staffEntry = all.body.items.find(
    (e: { actorEmail: string | null }) => e.actorEmail === USERS.l2,
  );
  expect(staffEntry).toBeTruthy();
  const only = await m.get(`/api/v1/audit-log?orgId=${ORG.narmada}`).expect(200);
  expect(only.body.items.every((e: { orgName: string }) => e.orgName.includes('Narmada'))).toBe(
    true,
  );
  const byActor = await m
    .get(`/api/v1/audit-log?actor=${encodeURIComponent('kaveribank')}`)
    .expect(200);
  expect(byActor.body.items.length).toBeGreaterThan(0);
  expect(
    byActor.body.items.every((e: { actorEmail: string }) => e.actorEmail.includes('kaveribank')),
  ).toBe(true);
  const byAction = await m.get('/api/v1/audit-log?action=case.').expect(200);
  expect(byAction.body.items.every((e: { action: string }) => e.action.startsWith('case.'))).toBe(
    true,
  );
  const first = byAction.body.items[0].seq;
  const older = await m.get(`/api/v1/audit-log?before=${first}`).expect(200);
  expect(older.body.items.every((e: { seq: number }) => e.seq < first)).toBe(true);
});

it('customer admins see only their organisation, with staff anonymised', async () => {
  const r = await (await t.as(USERS.kaveriAdmin)).get('/api/v1/audit-log').expect(200);
  expect(r.body.items.length).toBeGreaterThan(0);
  expect(r.body.items.every((e: { orgName: string }) => e.orgName.includes('Kaveri'))).toBe(true);
  const text = JSON.stringify(r.body);
  expect(text).not.toContain(USERS.l2);
  expect(text).not.toContain('Narmada');
  const staff = r.body.items.filter((e: { actor: string }) => e.actor === 'WatchDog Support');
  expect(staff.length).toBeGreaterThan(0);
  expect(staff.every((e: { diff: unknown; ip: unknown }) => e.diff === null && e.ip === null)).toBe(
    true,
  );
  // Cannot reach another organisation or the tamper check.
  const other = await (
    await t.as(USERS.kaveriAdmin)
  )
    .get(`/api/v1/audit-log?orgId=${ORG.narmada}`)
    .expect(200);
  expect(JSON.stringify(other.body)).not.toContain('Narmada');
  await (await t.as(USERS.kaveriAdmin)).get('/api/v1/audit-log/verify').expect(403);
  await (await t.as(USERS.kaveriUser)).get('/api/v1/audit-log').expect(403);
  await (await t.as(USERS.l2)).get('/api/v1/audit-log').expect(403);
});

it('the tamper check confirms the chain, and detects a changed entry', async () => {
  const ok = await (await t.as(USERS.sysadmin)).get('/api/v1/audit-log/verify').expect(200);
  expect(ok.body).toMatchObject({ intact: true, firstBadSeq: null });
  expect(ok.body.entries).toBeGreaterThan(0);
  // Simulate tampering with the owner role (the application role cannot UPDATE the log).
  const victim = (
    await t.owner.query(`SELECT seq, action FROM audit_log ORDER BY seq LIMIT 1 OFFSET 1`)
  ).rows[0];
  await t.owner.query(`ALTER TABLE audit_log DISABLE TRIGGER USER`);
  try {
    await t.owner.query(`UPDATE audit_log SET action = 'tampered' WHERE seq = $1`, [victim.seq]);
    const bad = await (await t.as(USERS.sysadmin)).get('/api/v1/audit-log/verify').expect(200);
    expect(bad.body).toMatchObject({ intact: false, firstBadSeq: Number(victim.seq) });
  } finally {
    // Put the original back so the chain verifies again for later tests.
    await t.owner.query(`UPDATE audit_log SET action = $2 WHERE seq = $1`, [
      victim.seq,
      victim.action,
    ]);
    await t.owner.query(`ALTER TABLE audit_log ENABLE TRIGGER USER`);
  }
  const again = await (await t.as(USERS.sysadmin)).get('/api/v1/audit-log/verify').expect(200);
  expect(again.body.intact).toBe(true);
});

it('exports CSV for the same scope', async () => {
  const r = await (await t.as(USERS.kaveriAdmin)).get('/api/v1/audit-log/export.csv').expect(200);
  expect(r.headers['content-type']).toContain('text/csv');
  expect(r.text).not.toContain('Narmada');
  expect(r.text).not.toContain(USERS.l2);
});

it('customers never see that internal notes were added', async () => {
  const staff = await (
    await t.as(USERS.manager)
  )
    .get('/api/v1/audit-log?action=case.note')
    .expect(200);
  expect(staff.body.items.length).toBeGreaterThan(0);
  const cust = await (await t.as(USERS.kaveriAdmin)).get('/api/v1/audit-log').expect(200);
  expect(cust.body.items.some((e: { action: string }) => e.action.includes('note'))).toBe(false);
});
