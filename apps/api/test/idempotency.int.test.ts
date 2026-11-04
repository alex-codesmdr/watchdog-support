/** Idempotency-Key on case creation: retries never open duplicate cases. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { caseBody, createTestApp, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(() => t.close());

const post = async (key: string | null, body: object, who: string = USERS.kaveriUser) => {
  const r = t.http.post('/api/v1/cases').set('authorization', `Bearer ${await t.token(who)}`);
  if (key) r.set('idempotency-key', key);
  return r.send(body);
};
const count = async () =>
  Number((await t.owner.query<{ n: string }>('SELECT count(*) AS n FROM support_case')).rows[0]!.n);

it('a retried request returns the same case, including concurrent retries', async () => {
  const body = caseBody(SERIAL.kaveriPremium, { subject: 'Idempotent create check' });
  const before = await count();
  const first = await post('retry-key-0001', body);
  expect(first.status).toBe(201);
  const again = await post('retry-key-0001', body);
  expect(again.status).toBe(201);
  expect(again.body.number).toBe(first.body.number);
  expect(await count()).toBe(before + 1);

  const burst = await Promise.all(Array.from({ length: 5 }, () => post('retry-key-0002', body)));
  const ok = burst.filter((r) => r.status === 201);
  expect(new Set(ok.map((r) => r.body.number)).size).toBe(1);
  expect(burst.every((r) => r.status === 201 || r.status === 409)).toBe(true);
  expect(await count()).toBe(before + 2);
});

it('the same key with a different body is refused; keys are per user', async () => {
  const body = caseBody(SERIAL.kaveriPremium, { subject: 'Key reuse A' });
  await post('reuse-key-0001', body).then((r) => expect(r.status).toBe(201));
  const other = await post('reuse-key-0001', { ...body, subject: 'Key reuse B' });
  expect(other.status).toBe(422);
  // Another user may use the same key string independently.
  const narmada = await post(
    'reuse-key-0001',
    caseBody(SERIAL.narmadaPremium, { subject: 'Key reuse A' }),
    USERS.narmadaUser,
  );
  expect(narmada.status).toBe(201);
  expect((await post('bad key!', body)).status).toBe(422);
});

it('a failed first attempt frees the key for a corrected retry', async () => {
  const bad = await post('fail-key-0001', caseBody('WDNOTREAL0001', { subject: 'Will fail' }));
  expect(bad.status).toBeGreaterThanOrEqual(400);
  const r = await t.owner.query(`SELECT 1 FROM idempotency_key WHERE key = 'fail-key-0001'`);
  expect(r.rowCount).toBe(0);
});
