/** Engineering issues from cases: raise, link existing, status sync, staff-only. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JiraService } from '../src/modules/jira/jira.service.js';
import type { MockJira } from '../src/modules/jira/jira.adapter.js';
import { JIRA } from '../src/tokens.js';
import { caseBody, createTestApp, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
let jira: MockJira;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
  jira = t.app.get(JIRA);
});
afterAll(() => t.close());

const open = async () =>
  (
    await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriMissionCritical, { severity: 'P2' }))
      .expect(201)
  ).body.number as string;

describe('engineering issues', () => {
  it('an L3 engineer raises an issue built from the case; it syncs back as staff-only history', async () => {
    const n = await open();
    const l3 = await t.as(USERS.l3);
    expect((await l3.get(`/api/v1/workspace/cases/${n}/jira`).expect(200)).body.link).toBeNull();
    const r = await l3
      .post(`/api/v1/workspace/cases/${n}/jira`, {
        notes: 'Reproduced on 7.1.070 with 48 ports up.',
      })
      .expect(201);
    expect(r.body.link).toMatchObject({ status: 'To Do', category: 'new' });
    const issue = jira.issues.get(r.body.link.key)!;
    expect(issue.summary).toContain(n);
    expect(issue.priority).toBe('High');
    expect(issue.description).toContain('Reproduced on 7.1.070');
    expect(issue.labels).toContain(`case-${n.toLowerCase()}`);

    await l3.post(`/api/v1/workspace/cases/${n}/jira`, {}).expect(409);

    jira.advance(r.body.link.key, 'In Progress', 'indeterminate');
    const ref = await l3.post(`/api/v1/workspace/cases/${n}/jira/refresh`).expect(200);
    expect(ref.body.link.status).toBe('In Progress');
    jira.advance(r.body.link.key, 'Done', 'done');
    expect(await t.app.get(JiraService).sync()).toBeGreaterThanOrEqual(1);

    const staff = (await l3.get(`/api/v1/cases/${n}`).expect(200)).body;
    const ev = staff.events.filter((e: { type: string }) => e.type.startsWith('jira'));
    expect(ev.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['jira_linked', 'jira_status']),
    );
    const cust = (await (await t.as(USERS.kaveriUser)).get(`/api/v1/cases/${n}`).expect(200)).body;
    expect(JSON.stringify(cust)).not.toContain(r.body.link.key);
  });

  it('links an existing issue by key, and refuses unknown keys', async () => {
    const existing = await jira.create({
      summary: 'Known defect',
      description: 'x',
      priority: 'Medium',
      labels: [],
    });
    const n = await open();
    const m = await t.as(USERS.manager);
    await m.post(`/api/v1/workspace/cases/${n}/jira`, { existingKey: 'WDENG-999999' }).expect(404);
    const r = await m
      .post(`/api/v1/workspace/cases/${n}/jira`, { existingKey: existing.key.toLowerCase() })
      .expect(201);
    expect(r.body.link.key).toBe(existing.key);
  });

  it('L1 and L2 engineers can see but not raise; customers have no access', async () => {
    const n = await open();
    await (await t.as(USERS.l2)).post(`/api/v1/workspace/cases/${n}/jira`, {}).expect(403);
    await (await t.as(USERS.l1)).get(`/api/v1/workspace/cases/${n}/jira`).expect(200);
    await (await t.as(USERS.kaveriAdmin)).get(`/api/v1/workspace/cases/${n}/jira`).expect(403);
  });
});
