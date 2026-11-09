/** Help assistant: answers only from articles the asker may read, cites them, records feedback. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunks, keywords, plain } from '../src/modules/assistant/assistant.service.js';
import { createTestApp, USERS, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(() => t.close());

describe('assistant helpers', () => {
  it('keeps meaningful words and splits articles into passages', () => {
    expect(keywords('How do I set up an IPsec VPN to my branch?')).toEqual([
      'set',
      'up',
      'ipsec',
      'vpn',
      'branch',
    ]);
    expect(plain('## Step 1\n**Run** `show version` and see [docs](/kb/x).')).toBe(
      'Step 1\nRun show version and see docs.',
    );
    const c = chunks(`# A\n\n${'word '.repeat(200)}\n\n## B\n\n${'more '.repeat(200)}`);
    expect(c.length).toBeGreaterThan(1);
  });
});

describe('ask', () => {
  it('answers a visitor from public articles with numbered sources', async () => {
    const r = await t.http
      .post('/api/v1/assistant/ask')
      .send({ question: 'How do I set up a site-to-site IPsec VPN?' })
      .expect(200);
    expect(r.body.found).toBe(true);
    expect(r.body.mode).toBe('extractive');
    expect(r.body.sources[0].slug).toMatch(/ipsec/);
    expect(r.body.answer).toContain('[1]');
    expect(r.body.answer).toContain('open a case');
  });

  it('never quotes articles the asker cannot read', async () => {
    const q = { question: 'PSU telemetry defect triage steps' };
    const anon = await t.http.post('/api/v1/assistant/ask').send(q).expect(200);
    expect(anon.body.sources.map((s: { slug: string }) => s.slug)).not.toContain(
      'internal-psu-telemetry-defect-triage',
    );
    const cust = await (await t.as(USERS.kaveriUser)).post('/api/v1/assistant/ask', q).expect(200);
    expect(cust.body.sources.map((s: { slug: string }) => s.slug)).not.toContain(
      'internal-psu-telemetry-defect-triage',
    );
    const staff = await (await t.as(USERS.l3)).post('/api/v1/assistant/ask', q).expect(200);
    expect(staff.body.sources.map((s: { slug: string }) => s.slug)).toContain(
      'internal-psu-telemetry-defect-triage',
    );
  });

  it('says so when nothing matches, and records feedback once', async () => {
    const r = await t.http
      .post('/api/v1/assistant/ask')
      .send({ question: 'zzqx flurbo wibble' })
      .expect(200);
    expect(r.body).toMatchObject({ found: false, sources: [] });
    expect(r.body.answer).toContain('could not find');
    await t.http
      .post(`/api/v1/assistant/${r.body.id}/feedback`)
      .send({ helpful: false })
      .expect(204);
    await t.http
      .post(`/api/v1/assistant/${r.body.id}/feedback`)
      .send({ helpful: true })
      .expect(404);
    const gaps = await (await t.as(USERS.content)).get('/api/v1/assistant/gaps').expect(200);
    expect(gaps.body.items.map((g: { question: string }) => g.question)).toContain(
      'zzqx flurbo wibble',
    );
    await (await t.as(USERS.kaveriUser)).get('/api/v1/assistant/gaps').expect(403);
    await t.http.post('/api/v1/assistant/ask').send({ question: 'hi' }).expect(400);
  });
});
