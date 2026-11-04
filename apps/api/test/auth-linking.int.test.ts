/**
 * First sign-in links the identity-provider subject to the portal account. A browser fires several
 * API calls at once on the first page load; every one of them must succeed (CI regression).
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp, ORG, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(() => t.close());

it('concurrent first requests all resolve to the same linked account', async () => {
  const email = 'first.login@kaveribank.example';
  const u = await t.owner.query<{ id: string }>(
    `INSERT INTO app_user (org_id, email, display_name, status) VALUES ($1, $2, 'First Login', 'invited') RETURNING id`,
    [ORG.kaveri, email],
  );
  await t.owner.query(`INSERT INTO user_role (user_id, role_key) VALUES ($1, 'customer_user')`, [
    u.rows[0]!.id,
  ]);
  const tok = await t.token(email, { sub: 'b7d1c1e4-5f7a-4c38-9a51-0d5e3f1c2a90' });
  const res = await Promise.all(
    Array.from({ length: 12 }, () =>
      t.http.get('/api/v1/me').set('authorization', `Bearer ${tok}`),
    ),
  );
  expect(res.map((r) => r.status)).toEqual(Array(12).fill(200));
  const row = await t.owner.query(`SELECT kc_subject, status FROM app_user WHERE id = $1`, [
    u.rows[0]!.id,
  ]);
  expect(row.rows[0]).toEqual({
    kc_subject: 'b7d1c1e4-5f7a-4c38-9a51-0d5e3f1c2a90',
    status: 'active',
  });

  // A different identity presenting the same email cannot take over the linked account.
  const other = await t.token(email, { sub: 'another-subject' });
  await t.http.get('/api/v1/me').set('authorization', `Bearer ${other}`).expect(403);
});
