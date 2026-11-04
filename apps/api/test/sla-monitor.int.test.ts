/**
 * SLA engine (design §6.4): warnings at 50/75/90 %, breach at 100 %, escalation rules, matrix
 * notifications, auto-escalation of support level, idempotency, and pause behaviour.
 * Time is injected into tick(now), so the test controls the clock deterministically.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SlaMonitorService } from '../src/modules/sla/sla-monitor.service.js';
import { caseBody, createTestApp, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
let sla: SlaMonitorService;
const min = (n: number) => n * 60_000;

async function events(caseId: string, types: string[]) {
  const r = await t.owner.query<{
    type: string;
    data: { metric: string; threshold: number; escalatedTo: number | null };
  }>(`SELECT type, data FROM case_event WHERE case_id = $1 AND type = ANY($2) ORDER BY at`, [
    caseId,
    types,
  ]);
  return r.rows;
}

beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
  sla = t.app.get(SlaMonitorService);
});
afterAll(() => t.close());

describe('SLA monitor on a Mission-Critical P1 (24x7, first response 15 min)', () => {
  let id = '';
  let opened = 0;

  beforeAll(async () => {
    const r = await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriMissionCritical, { severity: 'P1' }))
      .expect(201);
    id = r.body.id;
    opened = new Date(r.body.openedAt).getTime();
    const me = await (await t.as(USERS.l1)).get('/api/v1/me');
    await (
      await t.as(USERS.l1)
    )
      .post(`/api/v1/cases/${id}/assign`, { assigneeId: me.body.id })
      .expect(200);
    await t.drainOutbox();
  });

  it('does nothing before 50 %', async () => {
    await sla.tick(new Date(opened + min(5)));
    expect(await events(id, ['sla_warning', 'sla_breached'])).toHaveLength(0);
  });

  it('warns the assignee at 50 % and is idempotent', async () => {
    const before = t.mail.sent.length;
    await sla.tick(new Date(opened + min(8)));
    await sla.tick(new Date(opened + min(8)));
    const ev = await events(id, ['sla_warning']);
    expect(ev.map((e) => [e.data.metric, e.data.threshold])).toEqual([['first_response', 50]]);
    await t.drainOutbox();
    const mails = t.mail.sent.slice(before);
    expect(mails.map((m) => m.to)).toEqual([USERS.l1]);
    expect(mails[0]!.subject).toMatch(/^\[SLA 50%\] WD-\d{4}-\d{6} First response due/);
  });

  it('jumps straight to the highest crossed threshold (75 % → managers)', async () => {
    const before = t.mail.sent.length;
    await sla.tick(new Date(opened + min(12)));
    expect((await events(id, ['sla_warning'])).map((e) => e.data.threshold)).toEqual([50, 75]);
    await t.drainOutbox();
    expect(
      t.mail.sent
        .slice(before)
        .map((m) => m.to)
        .sort(),
    ).toEqual([USERS.l1, USERS.manager].sort());
  });

  it('90 % alerts the duty manager from the escalation matrix', async () => {
    const before = t.mail.sent.length;
    await sla.tick(new Date(opened + min(14)));
    await t.drainOutbox();
    const to = t.mail.sent.slice(before).map((m) => m.to);
    expect(to).toEqual(
      expect.arrayContaining([
        USERS.manager,
        'duty.manager@watchdog.example',
        'mc.desk@watchdog.example',
      ]),
    );
    expect(to).not.toContain('head.support@watchdog.example'); // level 2 only on breach
  });

  it('breach stamps the clock, auto-escalates to L2 and alerts matrix level 2', async () => {
    const before = t.mail.sent.length;
    const r = await sla.tick(new Date(opened + min(16)));
    expect(r.breaches).toBeGreaterThanOrEqual(1);
    const clock = await t.owner.query(
      `SELECT breached_at, last_warn_pct FROM sla_clock WHERE case_id = $1 AND metric = 'first_response'`,
      [id],
    );
    expect(clock.rows[0].last_warn_pct).toBe(100);
    expect(new Date(clock.rows[0].breached_at).getTime()).toBe(opened + min(15));
    const c = await (await t.as(USERS.l2)).get(`/api/v1/cases/${id}`).expect(200);
    expect(c.body).toMatchObject({ supportLevel: 2, assigneeName: null });
    expect(
      c.body.sla.find((s: { metric: string }) => s.metric === 'first_response').breachedAt,
    ).not.toBeNull();
    await t.drainOutbox();
    const mails = t.mail.sent.slice(before);
    expect(
      mails.some(
        (m) => m.subject.startsWith('[SLA BREACH]') && m.to === 'head.support@watchdog.example',
      ),
    ).toBe(true);
    expect(mails.find((m) => m.subject.startsWith('[SLA BREACH]'))!.text).toMatch(
      /automatically escalated to L2/,
    );
    // breach is never repeated
    await sla.tick(new Date(opened + min(30)));
    expect(
      (await events(id, ['sla_breached'])).filter((e) => e.data.metric === 'first_response'),
    ).toHaveLength(1);
  });

  it('customers never see SLA warning events', async () => {
    const r = await (await t.as(USERS.kaveriUser)).get(`/api/v1/cases/${id}`).expect(200);
    expect(r.body.events.map((e: { type: string }) => e.type)).not.toContain('sla_warning');
    expect(r.body.events.map((e: { type: string }) => e.type)).not.toContain('sla_breached');
  });
});

describe('paused and met clocks', () => {
  it('a case awaiting the customer never warns or breaches', async () => {
    const r = await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriMissionCritical, { severity: 'P1' }))
      .expect(201);
    await (
      await t.as(USERS.l1)
    )
      .post(`/api/v1/cases/${r.body.id}/messages`, {
        body: 'Need logs',
        setStatus: 'awaiting_customer',
      })
      .expect(201);
    const opened = new Date(r.body.openedAt).getTime();
    await sla.tick(new Date(opened + min(60 * 48)));
    const ev = await events(r.body.id, ['sla_warning', 'sla_breached']);
    // first response was met by the reply; the rest are paused
    expect(ev).toHaveLength(0);
  });

  it('resolved cases are ignored', async () => {
    const r = await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriMissionCritical, { severity: 'P1' }))
      .expect(201);
    await (
      await t.as(USERS.l1)
    )
      .post(`/api/v1/cases/${r.body.id}/transition`, { to: 'resolved' })
      .expect(200);
    await sla.tick(new Date(new Date(r.body.openedAt).getTime() + min(60 * 48)));
    expect(await events(r.body.id, ['sla_warning', 'sla_breached'])).toHaveLength(0);
  });
});

describe('SLA report', () => {
  it('managers see compliance and breaches; customers and engineers cannot', async () => {
    const r = await (await t.as(USERS.manager)).get('/api/v1/reports/sla').expect(200);
    const row = r.body.rows.find(
      (x: { tier: string; severity: string; metric: string }) =>
        x.tier === 'mission_critical' && x.severity === 'P1' && x.metric === 'first_response',
    );
    expect(row.breached).toBeGreaterThanOrEqual(1);
    expect(r.body.breaches[0]).toMatchObject({
      metric: expect.any(String),
      caseNumber: expect.stringMatching(/^WD-/),
    });
    await (await t.as(USERS.kaveriAdmin)).get('/api/v1/reports/sla').expect(403);
    await (await t.as(USERS.l1)).get('/api/v1/reports/sla').expect(403);
    await (await t.as(USERS.manager)).get('/api/v1/reports/sla?from=2026-13-01').expect(400);
  });
});
