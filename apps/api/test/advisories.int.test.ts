/**
 * Phase 4b: security advisories. Draft → publish → revise → withdraw, public visibility, RSS,
 * subscriptions and exposure emails, PSIRT notes never leaking, runtime brand guard.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprintLine } from '@wd/brand-lint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, USERS, type TestApp } from './helpers.js';

// The brand guard reads one-way fingerprints. A made-up vendor name stands in for the real ones,
// which are never written into the repository.
const FAKE_VENDOR = 'Zorbex Networks';
const dir = mkdtempSync(join(tmpdir(), 'wd-fp-'));
writeFileSync(join(dir, 'fp.sha256'), `${fingerprintLine(FAKE_VENDOR)}\n`);
process.env.WD_PROHIBITED_FINGERPRINTS_FILE = join(dir, 'fp.sha256');

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(() => t.close());

const draft = {
  title: 'Authenticated command injection in the CoreLink web UI',
  summary: 'An authenticated administrator could run operating-system commands through the web UI.',
  severity: 'high',
  cvssScore: 8.1,
  cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:C/C:H/I:H/A:H',
  cveIds: ['CVE-2026-41234'],
  bodyMd: '## Details\nInput to the diagnostics page was not sanitised.',
  workaroundMd: 'Restrict web UI access to the management VLAN.',
  internalNotes: 'Reporter: researcher via security@. Upstream ticket PSIRT-77.',
  affected: [
    { sku: 'WD-SW5600-48P', affectedVersions: '7.1.000 to 7.1.070', fixedVersion: '7.1.075' },
  ],
};
let wdId = '';

describe('PSIRT workflow', () => {
  it('only PSIRT roles can author; drafts are invisible to everyone else', async () => {
    await (await t.as(USERS.l1)).post('/api/v1/admin/advisories', draft).expect(403);
    await (await t.as(USERS.kaveriAdmin)).get('/api/v1/admin/advisories').expect(403);
    const r = await (await t.as(USERS.l3)).post('/api/v1/admin/advisories', draft).expect(201);
    wdId = r.body.wdId;
    expect(wdId).toMatch(/^WDSA-\d{4}-\d{4}$/);
    expect(r.body).toMatchObject({ status: 'draft', internalNotes: draft.internalNotes });
    await t.http.get(`/api/v1/advisories/${wdId}`).expect(404);
    await (await t.as(USERS.kaveriUser)).get(`/api/v1/advisories/${wdId}`).expect(404);
    const pub = await t.http.get('/api/v1/advisories').expect(200);
    expect(pub.body.items.map((a: { wdId: string }) => a.wdId)).not.toContain(wdId);
  });

  it('refuses third-party vendor names in public text, but allows them in PSIRT notes', async () => {
    const bad = await (
      await t.as(USERS.l3)
    )
      .put(`/api/v1/admin/advisories/${wdId}`, {
        ...draft,
        summary: `Same issue as the ${FAKE_VENDOR} bug.`,
      })
      .expect(422);
    expect(bad.body.detail).toContain('summary');
    await (
      await t.as(USERS.l3)
    )
      .put(`/api/v1/admin/advisories/${wdId}`, {
        ...draft,
        internalNotes: `Upstream: ${FAKE_VENDOR} PSIRT`,
      })
      .expect(200);
  });

  it('publishing emails subscribers and customer admins with affected devices', async () => {
    const sub = await (
      await t.as(USERS.narmadaUser)
    )
      .put('/api/v1/me/advisory-subscription', { familyKeys: ['switching'], minSeverity: 'high' })
      .expect(200);
    expect(sub.body).toMatchObject({ subscribed: true, familyKeys: ['switching'] });
    await (
      await t.as(USERS.partner)
    )
      .put('/api/v1/me/advisory-subscription', { familyKeys: ['routing'], minSeverity: 'low' })
      .expect(200);
    const before = t.mail.sent.length;
    await (await t.as(USERS.l3)).post(`/api/v1/admin/advisories/${wdId}/publish`, {}).expect(200);
    await t.drainOutbox();
    const mails = t.mail.sent.slice(before).filter((m) => m.subject.includes(wdId));
    const to = mails.map((m) => m.to);
    expect(to).toContain(USERS.narmadaUser); // subscribed to switching, high+
    expect(to).not.toContain(USERS.partner); // subscribed to routing only
    expect(to).toContain(USERS.kaveriAdmin); // Kaveri has an installed SW5600
    expect(mails.find((m) => m.to === USERS.kaveriAdmin)?.text).toMatch(/installed device/);
    for (const m of mails) {
      expect(m.text).not.toContain('PSIRT-77');
      expect(m.text).not.toContain(FAKE_VENDOR);
    }
  });

  it('is public once published, with exposure for signed-in customers and no PSIRT notes', async () => {
    const anon = await t.http.get(`/api/v1/advisories/${wdId}`).expect(200);
    expect(anon.body).toMatchObject({
      status: 'published',
      revision: 1,
      yourDevices: null,
      severity: 'high',
    });
    expect(anon.body.affected[0]).toMatchObject({ sku: 'WD-SW5600-48P', fixedVersion: '7.1.075' });
    const json = JSON.stringify(anon.body);
    expect(json).not.toContain('PSIRT');
    expect(json).not.toContain('internalNotes');
    expect(json).not.toContain(FAKE_VENDOR);
    const k = await (await t.as(USERS.kaveriUser)).get(`/api/v1/advisories/${wdId}`).expect(200);
    expect(k.body.yourDevices).toBeGreaterThan(0);
    const filtered = await t.http.get('/api/v1/advisories?family=wireless').expect(200);
    expect(filtered.body.items.map((a: { wdId: string }) => a.wdId)).not.toContain(wdId);
    const byCve = await t.http.get('/api/v1/advisories?q=CVE-2026-41234').expect(200);
    expect(byCve.body.items[0].wdId).toBe(wdId);
  });

  it('the RSS feed lists it and is valid XML with escaped text', async () => {
    const r = await t.http.get('/api/v1/advisories/rss.xml').expect(200);
    expect(r.headers['content-type']).toContain('application/rss+xml');
    expect(r.text).toMatch(/^<\?xml version="1.0"/);
    expect(r.text).toContain(`<guid isPermaLink="false">${wdId}#r1</guid>`);
    expect(r.text).toContain('WatchDog security advisories');
  });

  it('editing a published advisory needs a change note and makes a new revision', async () => {
    await (
      await t.as(USERS.l3)
    )
      .put(`/api/v1/admin/advisories/${wdId}`, { ...draft, severity: 'critical' })
      .expect(422);
    const before = t.mail.sent.length;
    const r = await (
      await t.as(USERS.l3)
    )
      .put(`/api/v1/admin/advisories/${wdId}`, {
        ...draft,
        severity: 'critical',
        cvssScore: 9.1,
        revisionNote: 'Raised to Critical: unauthenticated path found.',
      })
      .expect(200);
    expect(r.body).toMatchObject({ revision: 2, severity: 'critical' });
    await t.drainOutbox();
    const upd = t.mail.sent.slice(before).find((m) => m.to === USERS.narmadaUser);
    expect(upd?.subject).toContain('Updated');
    expect(upd?.text).toContain('Raised to Critical');
  });

  it('withdrawing keeps the advisory visible as withdrawn', async () => {
    await (
      await t.as(USERS.l3)
    )
      .post(`/api/v1/admin/advisories/${wdId}/withdraw`, { reason: 'x' })
      .expect(400);
    await (
      await t.as(USERS.l3)
    )
      .post(`/api/v1/admin/advisories/${wdId}/withdraw`, {
        reason: 'Duplicate of an earlier advisory.',
      })
      .expect(200);
    const r = await t.http.get(`/api/v1/advisories/${wdId}`).expect(200);
    expect(r.body).toMatchObject({
      status: 'withdrawn',
      revisionNote: 'Duplicate of an earlier advisory.',
    });
    await (await t.as(USERS.l3)).put(`/api/v1/admin/advisories/${wdId}`, draft).expect(409);
  });

  it('subscriptions are per user and can be removed', async () => {
    await (
      await t.as(USERS.narmadaUser)
    )
      .put('/api/v1/me/advisory-subscription', { familyKeys: ['nope'] })
      .expect(422);
    await (await t.as(USERS.narmadaUser)).delete('/api/v1/me/advisory-subscription').expect(204);
    const s = await (
      await t.as(USERS.narmadaUser)
    )
      .get('/api/v1/me/advisory-subscription')
      .expect(200);
    expect(s.body.subscribed).toBe(false);
    const other = await (
      await t.as(USERS.partner)
    )
      .get('/api/v1/me/advisory-subscription')
      .expect(200);
    expect(other.body.subscribed).toBe(true);
  });
});
