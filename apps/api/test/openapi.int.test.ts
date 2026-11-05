/** The public integrator API description: right endpoints, API-key auth, nothing staff-only. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFingerprints, scanFingerprints } from '@wd/brand-lint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('integrator OpenAPI', () => {
  it('lists the API-key endpoints and the webhook events, with API-key security', async () => {
    const r = await t.http.get('/api/openapi.json').expect(200);
    const doc = r.body;
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/cases',
        '/api/v1/assets',
        '/api/v1/rmas',
        '/api/v1/advisories',
      ]),
    );
    expect(doc.components.securitySchemes).toEqual({
      apiKey: expect.objectContaining({ type: 'apiKey', name: 'Authorization' }),
    });
    expect(Object.keys(doc.webhooks)).toEqual(
      expect.arrayContaining(['case.created', 'rma.status_changed', 'entitlement.expiring']),
    );
  });

  it('exposes nothing staff-only and no third-party names', async () => {
    const text = JSON.stringify((await t.http.get('/api/openapi.json').expect(200)).body);
    expect(text).not.toMatch(/\/admin\/|\/internal|internalOemRef|oem/i);
    expect(text).not.toMatch(/bearer/i);
    const fp = parseFingerprints(
      readFileSync(
        fileURLToPath(new URL('../../../packages/brand-lint/prohibited.sha256', import.meta.url)),
        'utf8',
      ),
    );
    expect(scanFingerprints(text, fp)).toEqual([]);
  });

  it('the full staff description is available outside production only', async () => {
    const full = await t.http.get('/api/openapi.full.json').expect(200);
    expect(Object.keys(full.body.paths).length).toBeGreaterThan(
      Object.keys((await t.http.get('/api/openapi.json')).body.paths).length,
    );
  });
});
