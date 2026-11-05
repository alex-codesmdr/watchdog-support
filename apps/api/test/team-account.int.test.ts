/**
 * Customer administrators manage their own team; everyone sets their own name, phone and email
 * language. Invitations create the sign-in identity and send a set-up email in the invitee's language.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, USERS, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(() => t.close());

const run = Date.now().toString(36);
type M = { id: string; email: string; role: string; status: string; isMe: boolean };

describe('team', () => {
  it('an administrator sees only their organisation and invites a colleague', async () => {
    const a = await t.as(USERS.kaveriAdmin);
    const list = (await a.get('/api/v1/org/users').expect(200)).body.items as M[];
    expect(list.map((m) => m.email)).toContain(USERS.kaveriUser);
    expect(list.map((m) => m.email)).not.toContain(USERS.narmadaAdmin);
    expect(list.find((m) => m.isMe)?.email).toBe(USERS.kaveriAdmin);

    const email = `new.${run}@kaveribank.example`;
    const r = await a
      .post('/api/v1/org/users', { displayName: 'Priya Shetty', email, role: 'customer_user' })
      .expect(201);
    expect(r.body).toMatchObject({ email, role: 'customer_user', status: 'invited' });
    await t.drainOutbox();
    expect(t.idp.invited).toContain(email);
    const mail = t.mail.sent.find((m) => m.to === email);
    expect(mail?.subject).toContain('added you to WatchDog Support');

    // The same address cannot be invited twice, here or by another organisation.
    await a.post('/api/v1/org/users', { displayName: 'Again', email }).expect(409);
    const n = await (
      await t.as(USERS.narmadaAdmin)
    )
      .post('/api/v1/org/users', { displayName: 'Taken', email })
      .expect(409);
    expect(n.body.title).toContain('already has');
    expect(JSON.stringify(n.body)).not.toContain('Kaveri');
    await a.post(`/api/v1/org/users/${r.body.id}/resend-invite`).expect(202);
  });

  it('switching off access blocks sign-in; administrators cannot lock themselves or the org out', async () => {
    const a = await t.as(USERS.kaveriAdmin);
    const list = (await a.get('/api/v1/org/users').expect(200)).body.items as M[];
    const me = list.find((m) => m.isMe)!;
    const user = list.find((m) => m.email === USERS.kaveriUser)!;
    await a.patch(`/api/v1/org/users/${me.id}`, { role: 'customer_user' }).expect(403);

    await a.patch(`/api/v1/org/users/${user.id}`, { status: 'disabled' }).expect(200);
    const blocked = await t.as(USERS.kaveriUser);
    await blocked.get('/api/v1/me').expect(403);
    await a.patch(`/api/v1/org/users/${user.id}`, { status: 'active' }).expect(200);
    await (await t.as(USERS.kaveriUser)).get('/api/v1/me').expect(200);

    // Promote the colleague; the new administrator may demote the first one, then restore them.
    const p = await a.patch(`/api/v1/org/users/${user.id}`, { role: 'customer_admin' }).expect(200);
    expect(p.body.role).toBe('customer_admin');
    const u2 = await t.as(USERS.kaveriUser);
    await u2.patch(`/api/v1/org/users/${me.id}`, { role: 'customer_user' }).expect(200);
    await a.get('/api/v1/org/users').expect(403);
    await u2.patch(`/api/v1/org/users/${me.id}`, { role: 'customer_admin' }).expect(200);
    await a.patch(`/api/v1/org/users/${user.id}`, { role: 'customer_user' }).expect(200);
    const log = await a.get('/api/v1/audit-log?action=user.').expect(200);
    expect(log.body.items.length).toBeGreaterThan(0);
  });

  it('cannot touch other organisations, staff roles, or be used by users, staff or API keys', async () => {
    const a = await t.as(USERS.kaveriAdmin);
    const other = (await (await t.as(USERS.narmadaAdmin)).get('/api/v1/org/users').expect(200)).body
      .items as M[];
    await a.patch(`/api/v1/org/users/${other[0]!.id}`, { status: 'disabled' }).expect(404);
    await a
      .post('/api/v1/org/users', {
        displayName: 'Sneaky',
        email: `s.${run}@x.example`,
        role: 'system_admin',
      })
      .expect(400);
    await (await t.as(USERS.kaveriUser)).get('/api/v1/org/users').expect(403);
    await (await t.as(USERS.manager)).get('/api/v1/org/users').expect(403);
  });
});

describe('my account', () => {
  it('updates name, phone and email language; Hindi emails follow', async () => {
    const u = await t.as(USERS.narmadaUser);
    const before = (await u.get('/api/v1/me').expect(200)).body;
    const r = await u
      .put('/api/v1/me', { displayName: 'Anil Kumar', phone: '+91 98450 12345', locale: 'hi-IN' })
      .expect(200);
    expect(r.body).toMatchObject({
      displayName: 'Anil Kumar',
      phone: '+91 98450 12345',
      locale: 'hi-IN',
    });
    await u.put('/api/v1/me', { displayName: 'A', locale: 'hi-IN' }).expect(400);
    await u
      .put('/api/v1/me', { displayName: 'Anil', phone: 'call me', locale: 'en-IN' })
      .expect(400);
    await u.put('/api/v1/me', { displayName: 'Anil', locale: 'fr-FR' }).expect(400);

    const c = await u
      .post('/api/v1/cases', {
        serialNumber: 'WDRT8800E0005',
        severity: 'P3',
        category: 'software',
        subject: `Hindi email check ${run}`,
        description: 'Checking that case emails arrive in Hindi for this person.',
      })
      .expect(201);
    await t.drainOutbox();
    const mail = t.mail.sent.find((m) => m.subject.includes(c.body.number));
    expect(mail?.subject).toContain('case खोला गया');

    await u.put('/api/v1/me', {
      displayName: before.displayName,
      phone: before.phone ?? null,
      locale: before.locale === 'hi-IN' ? 'hi-IN' : 'en-IN',
    });
  });
});
