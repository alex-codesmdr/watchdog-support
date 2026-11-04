/**
 * Acceptance criterion: "A customer from Organization A can never access Organization B's cases,
 * assets, or files (proven by automated tests)". Two layers are tested independently:
 *   1. the HTTP API (every case route, assets, attachment URLs), and
 *   2. PostgreSQL row-level security directly, with no application code in the path.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asTenant, caseBody, createTestApp, ORG, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
let caseA: { id: string; number: string };
let caseB: { id: string; number: string };
let attachmentA: string;

beforeAll(async () => {
  t = await createTestApp();
  const a = await t.as(USERS.kaveriUser);
  // upload a file to org A's case so we can test file isolation too
  const tus = await t.http
    .post('/api/v1/uploads')
    .set('authorization', `Bearer ${await t.token(USERS.kaveriUser)}`)
    .set('Tus-Resumable', '1.0.0')
    .set('Upload-Length', '11')
    .set('Upload-Metadata', `filename ${Buffer.from('notes.txt').toString('base64')}`);
  expect(tus.status).toBe(201);
  const uploadId = tus.headers.location!.split('/').pop()!;
  await t.http
    .patch(`/api/v1/uploads/${uploadId}`)
    .set('authorization', `Bearer ${await t.token(USERS.kaveriUser)}`)
    .set('Tus-Resumable', '1.0.0')
    .set('Upload-Offset', '0')
    .set('Content-Type', 'application/offset+octet-stream')
    .send(Buffer.from('hello world'))
    .expect(204);
  const ra = await a.post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, { uploadIds: [uploadId] }));
  expect(ra.status).toBe(201);
  caseA = ra.body;
  attachmentA = ra.body.messages[0].attachments[0].id;
  await t.drainOutbox();
  const rb = await (await t.as(USERS.narmadaUser)).post('/api/v1/cases', caseBody(SERIAL.narmadaPremium));
  expect(rb.status).toBe(201);
  caseB = rb.body;
});
afterAll(() => t.close());

describe('API: cross-tenant access is indistinguishable from "not found"', () => {
  const foreign = [USERS.narmadaAdmin, USERS.narmadaUser];

  it.each(foreign)('%s cannot read org A case by id or number', async (who) => {
    const b = await t.as(who);
    await b.get(`/api/v1/cases/${caseA.id}`).expect(404);
    await b.get(`/api/v1/cases/${caseA.number}`).expect(404);
  });

  it.each(foreign)('%s cannot write to org A case', async (who) => {
    const b = await t.as(who);
    await b.post(`/api/v1/cases/${caseA.id}/messages`, { body: 'hello' }).expect(404);
    await b.post(`/api/v1/cases/${caseA.id}/transition`, { to: 'closed' }).expect(404);
    await b.post(`/api/v1/cases/${caseA.id}/escalate`, { justification: 'x'.repeat(30) }).expect(404);
    await b.post(`/api/v1/cases/${caseA.id}/csat`, { score: 1 }).expect(404);
  });

  it.each(foreign)('%s never sees org A cases in lists or search', async (who) => {
    const b = await t.as(who);
    const r = await b.get('/api/v1/cases?status=all&limit=100').expect(200);
    expect(r.body.items.every((c: { orgId: string }) => c.orgId === ORG.narmada)).toBe(true);
    const s = await b.get(`/api/v1/cases?status=all&q=${caseA.number}`).expect(200);
    expect(s.body.items).toHaveLength(0);
  });

  it('cannot fetch org A attachment URLs', async () => {
    await (await t.as(USERS.narmadaAdmin)).get(`/api/v1/attachments/${attachmentA}/url`).expect(404);
    await (await t.as(USERS.kaveriAdmin)).get(`/api/v1/attachments/${attachmentA}/url`).expect(200);
  });

  it('cannot resume or overwrite another user’s upload', async () => {
    const tus = await t.http
      .post('/api/v1/uploads')
      .set('authorization', `Bearer ${await t.token(USERS.kaveriUser)}`)
      .set('Tus-Resumable', '1.0.0')
      .set('Upload-Length', '5')
      .set('Upload-Metadata', `filename ${Buffer.from('a.log').toString('base64')}`)
      .expect(201);
    const id = tus.headers.location!.split('/').pop()!;
    await t.http
      .patch(`/api/v1/uploads/${id}`)
      .set('authorization', `Bearer ${await t.token(USERS.narmadaUser)}`)
      .set('Tus-Resumable', '1.0.0')
      .set('Upload-Offset', '0')
      .set('Content-Type', 'application/offset+octet-stream')
      .send(Buffer.from('evil!'))
      .expect(404);
    // and cannot bind it to their own case
    await (await t.as(USERS.narmadaUser)).post('/api/v1/cases', caseBody(SERIAL.narmadaPremium, { uploadIds: [id] })).expect(422);
  });

  it('cannot open a case against another org’s serial or orgId', async () => {
    const b = await t.as(USERS.narmadaUser);
    await b.post('/api/v1/cases', caseBody(SERIAL.kaveriPremium)).expect(422);
    await b.post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, { orgId: ORG.kaveri })).expect(404);
  });

  it('cannot see another org’s assets', async () => {
    const b = await t.as(USERS.narmadaAdmin);
    const r = await b.get(`/api/v1/assets?orgId=${ORG.kaveri}`).expect(200);
    expect(r.body.items).toHaveLength(0);
    const v = await b.get(`/api/v1/assets/validate?serial=${SERIAL.kaveriPremium}`).expect(200);
    expect(v.body).toMatchObject({ valid: false, reason: 'not_found' });
  });
});

describe('API: within an organisation and for partners', () => {
  it('a customer user sees only cases they raised; the customer admin sees the org', async () => {
    const adminCase = (await (await t.as(USERS.kaveriAdmin)).post('/api/v1/cases', caseBody(SERIAL.kaveriPremium)).expect(201)).body;
    await (await t.as(USERS.kaveriUser)).get(`/api/v1/cases/${adminCase.id}`).expect(404);
    await (await t.as(USERS.kaveriAdmin)).get(`/api/v1/cases/${caseA.id}`).expect(200);
  });

  it('a partner sees delegated customers only', async () => {
    const p = await t.as(USERS.partner);
    await p.get(`/api/v1/cases/${caseB.id}`).expect(200);
    await p.get(`/api/v1/cases/${caseA.id}`).expect(404);
    const created = await p.post('/api/v1/cases', caseBody(SERIAL.narmadaPremium, { orgId: ORG.narmada })).expect(201);
    expect(created.body.orgId).toBe(ORG.narmada);
    await p.post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, { orgId: ORG.kaveri })).expect(404);
  });
});

describe('Database: row-level security without the application', () => {
  const tenantTables = ['support_case', 'case_message', 'case_attachment', 'case_event', 'sla_clock', 'asset', 'entitlement', 'site', 'app_user', 'upload', 'csat_response'];

  it.each(tenantTables)('%s: no tenant context returns zero rows', async (table) => {
    const r = await asTenant(t.app_, {}, `SELECT count(*)::int AS n FROM ${table}`);
    expect(r.rows[0]!.n).toBe(0);
  });

  it.each(tenantTables)('%s: org B context never returns org A rows', async (table) => {
    const r = await asTenant(t.app_, { org: ORG.narmada }, `SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1`, [ORG.kaveri]);
    expect(r.rows[0]!.n).toBe(0);
  });

  it('org B context cannot insert rows into org A', async () => {
    await expect(asTenant(t.app_, { org: ORG.narmada }, `INSERT INTO case_message (case_id, author_is_staff, visibility, body_html) VALUES ($1, false, 'public', 'x')`, [caseA.id])).rejects.toThrow(/case not found/);
    await expect(asTenant(t.app_, { org: ORG.narmada }, `UPDATE support_case SET subject = 'pwned subject' WHERE id = $1 RETURNING id`, [caseA.id])).resolves.toMatchObject({ rowCount: 0 });
  });

  it('internal notes are invisible in customer context even via raw SQL', async () => {
    await (await t.as(USERS.l1)).post(`/api/v1/cases/${caseA.id}/messages`, { visibility: 'internal', body: 'Suspect known defect 4411' }).expect(201);
    const cust = await asTenant(t.app_, { org: ORG.kaveri }, `SELECT count(*)::int AS n FROM case_message WHERE case_id = $1 AND visibility = 'internal'`, [caseA.id]);
    expect(cust.rows[0]!.n).toBe(0);
    const staff = await asTenant(t.app_, { org: '00000000-0000-4000-8000-000000000100', internal: true }, `SELECT count(*)::int AS n FROM case_message WHERE case_id = $1 AND visibility = 'internal'`, [caseA.id]);
    expect(staff.rows[0]!.n).toBe(1);
  });

  it('customers cannot forge staff-authored or internal messages', async () => {
    await expect(asTenant(t.app_, { org: ORG.kaveri }, `INSERT INTO case_message (case_id, author_is_staff, visibility, body_html) VALUES ($1, true, 'public', 'x')`, [caseA.id])).rejects.toThrow(/row-level security/);
    await expect(asTenant(t.app_, { org: ORG.kaveri }, `INSERT INTO case_message (case_id, author_is_staff, visibility, body_html) VALUES ($1, false, 'internal', 'x')`, [caseA.id])).rejects.toThrow(/row-level security/);
  });

  it('the app role cannot read the internal OEM mapping column at all', async () => {
    await expect(asTenant(t.app_, { org: ORG.kaveri }, 'SELECT internal_oem_ref FROM product')).rejects.toThrow(/permission denied/);
    await expect(asTenant(t.app_, { org: ORG.kaveri }, `SELECT wd.product_internal_ref('WD-RT8800')`)).rejects.toThrow(/not permitted/);
  });

  it('the app role cannot modify or delete the audit log', async () => {
    await expect(asTenant(t.app_, { org: ORG.kaveri }, 'DELETE FROM audit_log')).rejects.toThrow(/permission denied/);
    await expect(asTenant(t.app_, { org: ORG.kaveri }, `UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/permission denied/);
  });
});

describe('Brand protection: internal mapping never reaches customers', () => {
  it('public catalog has no internal fields', async () => {
    const r = await t.http.get('/api/v1/catalog/products').expect(200);
    expect(JSON.stringify(r.body)).not.toMatch(/internal|OEM-REF/i);
  });
  it('customers get 403; L3 gets the mapping', async () => {
    await (await t.as(USERS.kaveriAdmin)).get('/api/v1/catalog/products/WD-RT8800/internal').expect(403);
    const r = await (await t.as(USERS.l3)).get('/api/v1/catalog/products/WD-RT8800/internal').expect(200);
    expect(r.body.internalOemRef).toBe('OEM-REF-3001');
  });
  it('case payloads for customers carry no internal fields', async () => {
    const r = await (await t.as(USERS.kaveriUser)).get(`/api/v1/cases/${caseA.id}`).expect(200);
    expect(JSON.stringify(r.body)).not.toMatch(/OEM-REF|internal_oem|Suspect known defect/);
  });
});
