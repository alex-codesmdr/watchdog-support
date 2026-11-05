/**
 * Phase 4d: announcement banners (audiences, schedule, ending, brand guard) and engineers' saved
 * replies (personal vs shared, who may edit, never visible to customers).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprintLine } from '@wd/brand-lint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, USERS, type TestApp } from './helpers.js';

const FAKE_VENDOR = 'Zorbex Networks';
const dir = mkdtempSync(join(tmpdir(), 'wd-fp-'));
writeFileSync(join(dir, 'fp.sha256'), `${fingerprintLine(FAKE_VENDOR)}\n`);
process.env.WD_PROHIBITED_FINGERPRINTS_FILE = join(dir, 'fp.sha256');

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(() => t.close());

const run = Date.now().toString(36);
type Item = { id: string; title: string; dismissible: boolean };
const titles = (b: { items: Item[] }) => b.items.map((i) => i.title);

describe('announcements', () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const m = await t.as(USERS.manager);
    for (const [k, body] of Object.entries({
      everyone: { title: `Everyone ${run}`, tone: 'maintenance', audience: 'everyone' },
      customers: { title: `Customers ${run}`, audience: 'customers' },
      staff: { title: `Staff ${run}`, audience: 'staff' },
      later: {
        title: `Later ${run}`,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    })) {
      const r = await m.post('/api/v1/admin/announcements', body).expect(201);
      ids[k] = r.body.id;
    }
  });

  it('each audience sees only its banners, and scheduled ones wait', async () => {
    const anon = titles((await t.http.get('/api/v1/announcements').expect(200)).body);
    expect(anon).toContain(`Everyone ${run}`);
    expect(anon).not.toContain(`Customers ${run}`);
    expect(anon).not.toContain(`Staff ${run}`);
    expect(anon).not.toContain(`Later ${run}`);
    const cust = titles(
      (await (await t.as(USERS.kaveriUser)).get('/api/v1/announcements').expect(200)).body,
    );
    expect(cust).toEqual(expect.arrayContaining([`Everyone ${run}`, `Customers ${run}`]));
    expect(cust).not.toContain(`Staff ${run}`);
    const staff = titles(
      (await (await t.as(USERS.l1)).get('/api/v1/announcements').expect(200)).body,
    );
    expect(staff).toEqual(expect.arrayContaining([`Everyone ${run}`, `Staff ${run}`]));
    expect(staff).not.toContain(`Customers ${run}`);
  });

  it('incidents cannot be dismissed and come first', async () => {
    const m = await t.as(USERS.content);
    const r = await m
      .post('/api/v1/admin/announcements', { title: `Incident ${run}`, tone: 'incident' })
      .expect(201);
    expect(r.body.state).toBe('live');
    const live = (await t.http.get('/api/v1/announcements').expect(200)).body.items as Item[];
    expect(live[0]).toMatchObject({ title: `Incident ${run}`, dismissible: false });
    await m.post(`/api/v1/admin/announcements/${r.body.id}/end`).expect(200);
  });

  it('ending a banner takes it down at once, and an ended scheduled one never shows', async () => {
    const m = await t.as(USERS.manager);
    const e = await m.post(`/api/v1/admin/announcements/${ids.everyone}/end`).expect(200);
    expect(e.body.state).toBe('ended');
    const l = await m.post(`/api/v1/admin/announcements/${ids.later}/end`).expect(200);
    expect(l.body.state).toBe('ended');
    const anon = titles((await t.http.get('/api/v1/announcements').expect(200)).body);
    expect(anon).not.toContain(`Everyone ${run}`);
    const list = (await m.get('/api/v1/admin/announcements').expect(200)).body.items as {
      id: string;
      state: string;
      createdBy: string;
    }[];
    expect(list.find((a) => a.id === ids.everyone)).toMatchObject({ state: 'ended' });
    expect(list.find((a) => a.id === ids.everyone)?.createdBy).toBeTruthy();
    const log = await (
      await t.as(USERS.sysadmin)
    )
      .get('/api/v1/audit-log?action=announcement.end')
      .expect(200);
    expect(log.body.items.length).toBeGreaterThan(0);
  });

  it('rejects bad windows, links and vendor names; customers and engineers cannot write', async () => {
    const m = await t.as(USERS.manager);
    await m
      .post('/api/v1/admin/announcements', {
        title: 'Past window',
        endsAt: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(422);
    await m
      .post('/api/v1/admin/announcements', { title: 'Bad link', linkUrl: 'javascript:alert(1)' })
      .expect(400);
    await m
      .post('/api/v1/admin/announcements', { title: 'Bad link', linkUrl: '//evil.example' })
      .expect(400);
    const b = await m
      .post('/api/v1/admin/announcements', { title: `Upgrade for ${FAKE_VENDOR} gear` })
      .expect(422);
    expect(b.body.detail).toContain('title');
    await (
      await t.as(USERS.kaveriAdmin)
    )
      .post('/api/v1/admin/announcements', { title: 'Customer banner' })
      .expect(403);
    await (await t.as(USERS.l2)).get('/api/v1/admin/announcements').expect(403);
  });

  it('editing keeps the start and updates the banner', async () => {
    const m = await t.as(USERS.manager);
    const r = await m
      .put(`/api/v1/admin/announcements/${ids.customers}`, {
        title: `Customers edited ${run}`,
        audience: 'customers',
        linkUrl: '/advisories',
      })
      .expect(200);
    expect(r.body).toMatchObject({ title: `Customers edited ${run}`, linkUrl: '/advisories' });
    await m.post(`/api/v1/admin/announcements/${ids.customers}/end`).expect(200);
    await m.post(`/api/v1/admin/announcements/${ids.staff}/end`).expect(200);
  });
});

describe('saved replies', () => {
  it('engineers keep personal replies that nobody else sees', async () => {
    const l1 = await t.as(USERS.l1);
    const r = await l1
      .post('/api/v1/saved-replies', {
        title: `Ask for logs ${run}`,
        body: 'Hello {{customer_name}}, please attach the diagnostic file for {{case_ref}}.',
      })
      .expect(201);
    expect(r.body).toMatchObject({ shared: false, editable: true });
    const mine = (await l1.get('/api/v1/saved-replies').expect(200)).body.items as Item[];
    expect(mine.map((i) => i.title)).toContain(`Ask for logs ${run}`);
    const l2 = await t.as(USERS.l2);
    const theirs = (await l2.get('/api/v1/saved-replies').expect(200)).body.items as Item[];
    expect(theirs.map((i) => i.title)).not.toContain(`Ask for logs ${run}`);
    await l2
      .put(`/api/v1/saved-replies/${r.body.id}`, { title: 'Mine now', body: 'x' })
      .expect(404);
    await l2.delete(`/api/v1/saved-replies/${r.body.id}`).expect(404);
    await l1
      .put(`/api/v1/saved-replies/${r.body.id}`, { title: `Ask for logs v2 ${run}`, body: 'Hi' })
      .expect(200);
    await l1.delete(`/api/v1/saved-replies/${r.body.id}`).expect(204);
  });

  it('only managers share replies; every engineer can use shared ones but not change them', async () => {
    await (
      await t.as(USERS.l3)
    )
      .post('/api/v1/saved-replies', { title: 'Shared try', body: 'x', shared: true })
      .expect(403);
    const m = await t.as(USERS.manager);
    const s = await m
      .post('/api/v1/saved-replies', {
        title: `Closing note ${run}`,
        body: 'Thanks {{customer_name}}. I will close {{case_ref}} now. {{my_name}}',
        shared: true,
      })
      .expect(201);
    expect(s.body.shared).toBe(true);
    const l3 = await t.as(USERS.l3);
    const seen = (await l3.get('/api/v1/saved-replies').expect(200)).body.items as (Item & {
      editable: boolean;
    })[];
    expect(seen.find((i) => i.id === s.body.id)).toMatchObject({ editable: false });
    await l3.put(`/api/v1/saved-replies/${s.body.id}`, { title: 'Changed', body: 'x' }).expect(403);
    await l3.delete(`/api/v1/saved-replies/${s.body.id}`).expect(403);
    await m.delete(`/api/v1/saved-replies/${s.body.id}`).expect(204);
  });

  it('customers and content editors have no saved replies; vendor names are refused', async () => {
    await (await t.as(USERS.kaveriAdmin)).get('/api/v1/saved-replies').expect(403);
    await (await t.as(USERS.content)).get('/api/v1/saved-replies').expect(403);
    const b = await (
      await t.as(USERS.l1)
    )
      .post('/api/v1/saved-replies', { title: 'Vendor tip', body: `Same as ${FAKE_VENDOR} box` })
      .expect(422);
    expect(b.body.detail).toContain('body');
  });
});
