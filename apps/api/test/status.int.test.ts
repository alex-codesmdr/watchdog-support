/** Public status page: anyone reads; staff open incidents, post updates, resolve. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, USERS, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(async () => {
  await t.owner.query(`UPDATE status_component SET status = 'operational'`);
  await t.owner.query(`UPDATE status_incident SET resolved_at = now() WHERE resolved_at IS NULL`);
  await t.close();
});

describe('status page', () => {
  it('shows every service working normally by default', async () => {
    const r = await t.http.get('/api/v1/public/status').expect(200);
    expect(r.body.components.map((c: { name: string }) => c.name)).toContain('Support portal');
    expect(r.body.overall).toBe('operational');
  });

  it('an incident marks services, takes updates, and resolving restores them', async () => {
    const m = await t.as(USERS.manager);
    const cur = (await t.http.get('/api/v1/public/status').expect(200)).body;
    const email = cur.components.find((c: { name: string }) => c.name === 'Case email').id;
    const opened = await m
      .post('/api/v1/admin/status/incidents', {
        title: 'Case emails delayed',
        impact: 'minor',
        componentIds: [email],
        componentStatus: 'degraded',
        body: 'Case notification emails are arriving up to 20 minutes late. Cases are not affected.',
      })
      .expect(201);
    expect(opened.body.overall).toBe('degraded');
    const inc = opened.body.active.find(
      (i: { title: string }) => i.title === 'Case emails delayed',
    );
    expect(inc.updates).toHaveLength(1);

    await m
      .post(`/api/v1/admin/status/incidents/${inc.id}/updates`, {
        status: 'identified',
        body: 'Our email provider has a queue backlog; they are clearing it.',
      })
      .expect(201);
    const done = await m
      .post(`/api/v1/admin/status/incidents/${inc.id}/updates`, {
        status: 'resolved',
        body: 'Emails are on time again.',
      })
      .expect(201);
    expect(done.body.components.find((c: { id: string }) => c.id === email).status).toBe(
      'operational',
    );
    const recent = done.body.recent.find((i: { id: string }) => i.id === inc.id);
    expect(recent.updates.map((u: { status: string }) => u.status)).toEqual([
      'resolved',
      'identified',
      'investigating',
    ]);
    await m
      .post(`/api/v1/admin/status/incidents/${inc.id}/updates`, {
        status: 'monitoring',
        body: 'Late update after close',
      })
      .expect(422);
  });

  it('only managers and system administrators write; vendor names are refused', async () => {
    const cur = (await t.http.get('/api/v1/public/status').expect(200)).body;
    const id = cur.components[0].id;
    await (
      await t.as(USERS.l2)
    )
      .post(`/api/v1/admin/status/components/${id}`, { status: 'degraded' })
      .expect(403);
    await (
      await t.as(USERS.kaveriAdmin)
    )
      .post(`/api/v1/admin/status/components/${id}`, { status: 'degraded' })
      .expect(403);
    const s = await (
      await t.as(USERS.sysadmin)
    )
      .post(`/api/v1/admin/status/components/${id}`, { status: 'maintenance' })
      .expect(201);
    expect(s.body.overall).toBe('maintenance');
    await (
      await t.as(USERS.sysadmin)
    )
      .post(`/api/v1/admin/status/components/${id}`, { status: 'operational' })
      .expect(201);
  });
});
