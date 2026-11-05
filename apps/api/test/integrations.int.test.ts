/**
 * Phase 4c: organisation API keys and signed webhooks.
 */
import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPrivateAddress, checkWebhookUrl } from '../src/common/ssrf.js';
import { WebhooksService } from '../src/modules/integrations/webhooks.service.js';
import { caseBody, createTestApp, ORG, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
let server: Server;
let base = '';
let failNext = 0;
const received: Array<{ headers: IncomingHttpHeaders; body: string; path: string }> = [];

beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100, allowPrivateWebhooks: true });
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body, path: req.url ?? '' });
      if (req.url?.startsWith('/redirect')) {
        res.writeHead(302, { location: 'http://169.254.169.254/latest' }).end();
      } else if (failNext > 0 || req.url?.startsWith('/down')) {
        failNext = Math.max(0, failNext - 1);
        res.writeHead(503).end('nope');
      } else res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await t.close();
  await new Promise<void>((r) => server.close(() => r()));
});

const api = (key: string) => ({
  get: (u: string) => t.http.get(u).set('authorization', `WD-Key ${key}`),
  post: (u: string, b: object) => t.http.post(u).set('authorization', `WD-Key ${key}`).send(b),
});

describe('API keys', () => {
  let key = '';
  let keyId = '';

  it('a customer admin creates a key; the full key is shown once, only the prefix afterwards', async () => {
    const admin = await t.as(USERS.kaveriAdmin);
    const r = await admin
      .post('/api/v1/org/api-keys', {
        name: 'ServiceNow sync',
        scopes: ['cases:read', 'assets:read'],
      })
      .expect(201);
    key = r.body.key;
    keyId = r.body.id;
    expect(key).toMatch(/^wdk_[a-z0-9]{10}_[A-Za-z0-9]{40}$/);
    const list = await admin.get('/api/v1/org/api-keys').expect(200);
    expect(JSON.stringify(list.body)).not.toContain(key.split('_')[2]);
    expect(list.body.items[0]).toMatchObject({
      name: 'ServiceNow sync',
      prefix: key.split('_').slice(0, 2).join('_'),
    });
    const stored = await t.owner.query(`SELECT secret_hash FROM api_key WHERE id = $1`, [keyId]);
    expect(stored.rows[0].secret_hash).toMatch(/^scrypt\$/);
  });

  it('only customer admins manage keys', async () => {
    await (await t.as(USERS.kaveriUser)).get('/api/v1/org/api-keys').expect(403);
    await (await t.as(USERS.manager)).get('/api/v1/org/api-keys').expect(403);
  });

  it('the key reads its own organisation within its scopes and nothing else', async () => {
    await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, { subject: 'Visible to the key' }))
      .expect(201);
    const cases = await api(key).get('/api/v1/cases').expect(200);
    expect(cases.body.items.length).toBeGreaterThan(0);
    expect(cases.body.items.every((c: { orgId: string }) => c.orgId === ORG.kaveri)).toBe(true);
    const assets = await api(key).get('/api/v1/assets').expect(200);
    expect(assets.body.items.length).toBeGreaterThan(0);
    // No cases:write scope.
    await api(key).post('/api/v1/cases', caseBody(SERIAL.kaveriPremium)).expect(403);
    // No RMA scope.
    await api(key).get('/api/v1/rmas').expect(403);
    // A key can never manage keys or webhooks, even an admin's.
    await api(key).get('/api/v1/org/api-keys').expect(403);
    // Another tenant's data stays invisible.
    const n = await (
      await t.as(USERS.narmadaUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.narmadaPremium, { subject: 'Narmada private case' }))
      .expect(201);
    await api(key).get(`/api/v1/cases/${n.body.number}`).expect(404);
  });

  it('a write-scoped key opens cases as its administrator', async () => {
    const r = await (
      await t.as(USERS.kaveriAdmin)
    )
      .post('/api/v1/org/api-keys', { name: 'Monitoring', scopes: ['cases:write', 'cases:read'] })
      .expect(201);
    const c = await api(r.body.key)
      .post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, { subject: 'Opened by monitoring' }))
      .expect(201);
    expect(c.body.number).toBeTruthy();
  });

  it('wrong, malformed, revoked and expired keys are refused', async () => {
    const wrong = key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A');
    await api(wrong).get('/api/v1/cases').expect(401);
    await api('wdk_nope').get('/api/v1/cases').expect(401);
    await api(`wdk_zzzzzzzzzz_${'x'.repeat(40)}`)
      .get('/api/v1/cases')
      .expect(401);
    await t.owner.query(`UPDATE api_key SET expires_at = now() - interval '1 day' WHERE id = $1`, [
      keyId,
    ]);
    await api(key).get('/api/v1/cases').expect(401);
    await t.owner.query(`UPDATE api_key SET expires_at = now() + interval '1 day' WHERE id = $1`, [
      keyId,
    ]);
    await api(key).get('/api/v1/cases').expect(200);
    await (await t.as(USERS.kaveriAdmin)).delete(`/api/v1/org/api-keys/${keyId}`).expect(204);
    await api(key).get('/api/v1/cases').expect(401);
  });
});

describe('webhooks', () => {
  let hookId = '';
  let secret = '';

  it('blocks internal network targets (SSRF)', async () => {
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('100.64.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
    await expect(checkWebhookUrl('http://example.com/hook', false)).rejects.toThrow(/https/);
    await expect(checkWebhookUrl('https://127.0.0.1/hook', false)).rejects.toThrow(/public/);
    await expect(checkWebhookUrl('https://[::1]/hook', false)).rejects.toThrow(/public/);
    await expect(checkWebhookUrl('https://user:pw@8.8.8.8/x', false)).rejects.toThrow(
      /credentials/,
    );
  });

  it('creates a webhook and shows the signing secret once', async () => {
    await t.drainOutbox(); // events from earlier tests must not reach the new webhook
    const r = await (
      await t.as(USERS.kaveriAdmin)
    )
      .post('/api/v1/org/webhooks', {
        url: `${base}/hook`,
        events: ['case.created', 'case.status_changed'],
      })
      .expect(201);
    hookId = r.body.id;
    secret = r.body.secret;
    expect(secret).toMatch(/^whsec_/);
    const list = await (await t.as(USERS.kaveriAdmin)).get('/api/v1/org/webhooks').expect(200);
    expect(JSON.stringify(list.body)).not.toContain(secret);
    const enc = await t.owner.query(`SELECT secret_enc FROM webhook WHERE id = $1`, [hookId]);
    expect(enc.rows[0].secret_enc).not.toContain(secret);
  });

  it('delivers a signed, minimal event for the organisation only', async () => {
    received.length = 0;
    const c = await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, { subject: 'Webhook check' }))
      .expect(201);
    // A Narmada case must not reach Kaveri's webhook.
    await (
      await t.as(USERS.narmadaUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.narmadaPremium, { subject: 'Not for Kaveri' }))
      .expect(201);
    await t.drainOutbox();
    expect(received).toHaveLength(1);
    const d = received[0]!;
    const body = JSON.parse(d.body);
    expect(body).toMatchObject({
      type: 'case.created',
      data: { number: c.body.number, subject: 'Webhook check' },
    });
    expect(d.headers['x-wd-event']).toBe('case.created');
    const [tPart, vPart] = String(d.headers['x-wd-signature']).split(',');
    const ts = tPart!.slice(2);
    const want = createHmac('sha256', secret).update(`${ts}.${d.body}`).digest('hex');
    expect(vPart).toBe(`v1=${want}`);
    expect(d.body).not.toMatch(/internal|assignee|engineer/i);
  });

  it('retries failures with backoff and records the outcome', async () => {
    received.length = 0;
    failNext = 1;
    await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, { subject: 'Retry check' }))
      .expect(201);
    await t.drainOutbox();
    let row = (
      await t.owner.query(
        `SELECT * FROM webhook_delivery WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [hookId],
      )
    ).rows[0];
    expect(row).toMatchObject({ status: 'pending', attempts: 1, last_status: 503 });
    await t.owner.query(`UPDATE webhook_delivery SET next_attempt_at = now() WHERE id = $1`, [
      row.id,
    ]);
    await t.app.get(WebhooksService).retryDue();
    row = (await t.owner.query(`SELECT * FROM webhook_delivery WHERE id = $1`, [row.id])).rows[0];
    expect(row).toMatchObject({ status: 'succeeded', attempts: 2, last_status: 204 });
    // The same event is never delivered twice per webhook.
    expect(received.filter((r) => JSON.parse(r.body).data.subject === 'Retry check')).toHaveLength(
      2,
    );
  });

  it('delivers to a host name, connecting to the address that was checked', async () => {
    const admin = await t.as(USERS.kaveriAdmin);
    const h = await admin
      .post('/api/v1/org/webhooks', {
        url: base.replace('127.0.0.1', 'localhost') + '/hook',
        events: ['case.created'],
      })
      .expect(201);
    const r = await admin.post(`/api/v1/org/webhooks/${h.body.id}/test`, {}).expect(200);
    expect(r.body).toMatchObject({ ok: true, status: 204 });
    await admin.delete(`/api/v1/org/webhooks/${h.body.id}`).expect(204);
  });

  it('does not follow redirects; switches itself off after repeated failures', async () => {
    const admin = await t.as(USERS.kaveriAdmin);
    const red = await admin
      .post('/api/v1/org/webhooks', { url: `${base}/redirect`, events: ['case.created'] })
      .expect(201);
    const test = await admin.post(`/api/v1/org/webhooks/${red.body.id}/test`, {}).expect(200);
    expect(test.body).toMatchObject({ ok: false, status: 302 });
    expect(received.some((r) => r.path.startsWith('/latest'))).toBe(false);

    const down = await admin
      .post('/api/v1/org/webhooks', { url: `${base}/down`, events: ['case.created'] })
      .expect(201);
    await t.owner.query(`UPDATE webhook SET consecutive_failures = 4 WHERE id = $1`, [
      down.body.id,
    ]);
    await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriPremium, { subject: 'Down check' }))
      .expect(201);
    await t.drainOutbox();
    // Exhaust the retries quickly.
    await t.owner.query(
      `UPDATE webhook_delivery SET attempts = 7, next_attempt_at = now() WHERE webhook_id = $1`,
      [down.body.id],
    );
    await t.app.get(WebhooksService).retryDue();
    const w = (
      await t.owner.query(`SELECT active, disabled_reason FROM webhook WHERE id = $1`, [
        down.body.id,
      ])
    ).rows[0];
    expect(w.active).toBe(false);
    expect(w.disabled_reason).toMatch(/Switched off/);
    const list = await admin.get('/api/v1/org/webhooks').expect(200);
    const view = list.body.items.find((x: { id: string }) => x.id === down.body.id);
    expect(view).toMatchObject({ active: false });
    expect(view.recent[0]).toMatchObject({ status: 'failed', lastStatus: 503 });
  });

  it('other organisations cannot see or change the webhook; secrets can be rotated', async () => {
    const other = await t.as(USERS.narmadaAdmin);
    const l = await other.get('/api/v1/org/webhooks').expect(200);
    expect(l.body.items).toEqual([]);
    await other.delete(`/api/v1/org/webhooks/${hookId}`).expect(404);
    await other.post(`/api/v1/org/webhooks/${hookId}/test`, {}).expect(404);
    const r = await (
      await t.as(USERS.kaveriAdmin)
    )
      .post(`/api/v1/org/webhooks/${hookId}/rotate-secret`, {})
      .expect(200);
    expect(r.body.secret).not.toBe(secret);
  });
});
