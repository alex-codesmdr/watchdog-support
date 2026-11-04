/**
 * Acceptance criterion 4: "Serial-number warranty lookup works and is rate-limited".
 * Also: single-use proof-of-work CAPTCHA, and no customer-identifying data in the response.
 */
import { solveChallenge } from 'altcha-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, SERIAL, type TestApp } from './helpers.js';

let t: TestApp;

async function token(ip = '198.51.100.7'): Promise<string> {
  const c = await t.http.get('/api/v1/public/challenge').set('X-Forwarded-For', ip).expect(200);
  const s = await solveChallenge(c.body.challenge, c.body.salt, c.body.algorithm, c.body.maxnumber)
    .promise;
  expect(s).not.toBeNull();
  return Buffer.from(
    JSON.stringify({
      algorithm: c.body.algorithm,
      challenge: c.body.challenge,
      number: s!.number,
      salt: c.body.salt,
      signature: c.body.signature,
    }),
  ).toString('base64');
}
const lookup = (serialNumber: string, captchaToken: string, ip = '198.51.100.7') =>
  t.http
    .post('/api/v1/public/warranty-lookup')
    .set('X-Forwarded-For', ip)
    .send({ serialNumber, captchaToken });

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('public warranty lookup', () => {
  it('returns coverage for a registered serial, with no customer details', async () => {
    const r = await lookup(SERIAL.kaveriMissionCritical, await token()).expect(200);
    expect(r.body).toMatchObject({ found: true, modelName: 'WatchDog CoreLink SW5600-48P' });
    expect(r.body.coverage[0]).toMatchObject({
      kind: 'amc',
      tier: 'mission_critical',
      active: true,
    });
    expect(JSON.stringify(r.body)).not.toMatch(/Kaveri|Bengaluru|Mysuru|CTR-|org/i);
  });

  it('normalises case and spaces, and reports expired coverage as inactive', async () => {
    const r = await lookup(` ${SERIAL.kaveriExpired.toLowerCase()} `, await token()).expect(200);
    expect(r.body.found).toBe(true);
    expect(r.body.coverage.every((c: { active: boolean }) => !c.active)).toBe(true);
  });

  it('answers "not found" for unknown serials', async () => {
    const r = await lookup('WDNOTAREAL1', await token()).expect(200);
    expect(r.body).toEqual({ found: false, modelName: null, coverage: [] });
  });

  it('rejects missing, forged and reused CAPTCHA solutions', async () => {
    await lookup(SERIAL.kaveriPremium, 'x').expect(400);
    const good = await token();
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(good, 'base64').toString()), number: 1 }),
    ).toString('base64');
    await lookup(SERIAL.kaveriPremium, forged).expect(400);
    await lookup(SERIAL.kaveriPremium, good).expect(200);
    const replay = await lookup(SERIAL.kaveriPremium, good).expect(400);
    expect(replay.body.title).toMatch(/Verification failed/);
  });

  it('is rate-limited per client (20 per hour)', async () => {
    const ip = '203.0.113.50';
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++)
      statuses.push((await lookup(SERIAL.kaveriPremium, 'invalid', ip)).status);
    expect(statuses.slice(0, 20).every((s) => s === 400)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
