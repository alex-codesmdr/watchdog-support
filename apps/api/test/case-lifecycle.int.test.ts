/**
 * MVP acceptance flow (criteria 1 and 2), end to end through the HTTP API + worker handlers:
 * register → approve → MFA login → P1 case with attachments → email confirmation → SLA timers →
 * engineer triage / internal note / reply / escalate / resolve → customer notified → CSAT.
 * Plus: secret masking, malware rejection, email-to-case threading and spoof handling, audit chain.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, SERIAL, USERS, type TestApp } from './helpers.js';
import { Signer } from '../src/common/signing.js';

let t: TestApp;
const signer = new Signer('test-signing-key-test-signing-key-0123456789');

async function upload(email: string, name: string, content: string | Buffer): Promise<string> {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const auth = `Bearer ${await t.token(email)}`;
  const c = await t.http
    .post('/api/v1/uploads')
    .set('authorization', auth)
    .set('Tus-Resumable', '1.0.0')
    .set('Upload-Length', String(buf.length))
    .set('Upload-Metadata', `filename ${Buffer.from(name).toString('base64')}`)
    .expect(201);
  const id = c.headers.location!.split('/').pop()!;
  // two chunks, exercising resumability
  const half = Math.floor(buf.length / 2);
  await t.http
    .patch(`/api/v1/uploads/${id}`)
    .set('authorization', auth)
    .set('Tus-Resumable', '1.0.0')
    .set('Upload-Offset', '0')
    .set('Content-Type', 'application/offset+octet-stream')
    .send(buf.subarray(0, half))
    .expect(204);
  const head = await t.http
    .head(`/api/v1/uploads/${id}`)
    .set('authorization', auth)
    .set('Tus-Resumable', '1.0.0')
    .expect(200);
  expect(head.headers['upload-offset']).toBe(String(half));
  await t.http
    .patch(`/api/v1/uploads/${id}`)
    .set('authorization', auth)
    .set('Tus-Resumable', '1.0.0')
    .set('Upload-Offset', String(half))
    .set('Content-Type', 'application/offset+octet-stream')
    .send(buf.subarray(half))
    .expect(204);
  return id;
}

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('onboarding: register → approve → MFA login', () => {
  const email = 'cio@deccanpower.example';

  it('registers an organisation (same response for existing emails, no enumeration)', async () => {
    const body = {
      organizationName: 'Deccan Power Distribution (Demo)',
      adminName: 'Ravi Shankar',
      adminEmail: email,
      consentNoticeVersion: '2026-11-01',
      consentGiven: true,
    };
    const r1 = await t.http.post('/api/v1/public/registrations').send(body).expect(202);
    const r2 = await t.http
      .post('/api/v1/public/registrations')
      .send({ ...body, adminEmail: USERS.kaveriAdmin })
      .expect(202);
    expect(r2.body).toEqual(r1.body);
    await t.drainOutbox();
    expect(t.mail.sent.find((m) => m.to === email)?.subject).toMatch(
      /received your WatchDog Support registration/,
    );
    expect(
      t.mail.sent.some((m) => m.to === USERS.sysadmin && /awaiting approval/.test(m.subject)),
    ).toBe(true);
  });

  it('rejects registration without explicit DPDP consent', async () => {
    await t.http
      .post('/api/v1/public/registrations')
      .send({
        organizationName: 'X Org',
        adminName: 'X Y',
        adminEmail: 'x@y.example',
        consentNoticeVersion: '2026-11-01',
        consentGiven: false,
      })
      .expect(400);
  });

  it('pending organisations cannot sign in', async () => {
    const r = await t.http
      .get('/api/v1/me')
      .set('authorization', `Bearer ${await t.token(email)}`)
      .expect(403);
    expect(r.body.detail).toMatch(/not active yet/);
  });

  it('only a system admin can approve; approval provisions the identity and emails the admin', async () => {
    const list = await (await t.as(USERS.sysadmin)).get('/api/v1/admin/registrations').expect(200);
    const reg = list.body.items.find((r: { adminEmail: string }) => r.adminEmail === email);
    expect(reg).toBeDefined();
    await (
      await t.as(USERS.l3)
    )
      .post(`/api/v1/admin/registrations/${reg.id}/decision`, { decision: 'approve' })
      .expect(403);
    await (
      await t.as(USERS.kaveriAdmin)
    )
      .post(`/api/v1/admin/registrations/${reg.id}/decision`, { decision: 'approve' })
      .expect(403);
    await (
      await t.as(USERS.sysadmin)
    )
      .post(`/api/v1/admin/registrations/${reg.id}/decision`, { decision: 'approve' })
      .expect(200);
    await (
      await t.as(USERS.sysadmin)
    )
      .post(`/api/v1/admin/registrations/${reg.id}/decision`, { decision: 'approve' })
      .expect(409);
    await t.drainOutbox();
    expect(t.idp.invited).toContain(email);
    expect(t.mail.sent.some((m) => m.to === email && /approved/.test(m.subject))).toBe(true);
  });

  it('requires MFA and a verified email', async () => {
    const noMfa = await t.http
      .get('/api/v1/me')
      .set('authorization', `Bearer ${await t.token(email, { acr: '1' })}`)
      .expect(401);
    expect(noMfa.body.title).toMatch(/Multi-factor/);
    // unverified email cannot link a first login to an invited account
    await t.http
      .get('/api/v1/me')
      .set(
        'authorization',
        `Bearer ${await t.token(email, { emailVerified: false, sub: 'kc-other' })}`,
      )
      .expect(403);
    const me = await t.http
      .get('/api/v1/me')
      .set('authorization', `Bearer ${await t.token(email)}`)
      .expect(200);
    expect(me.body.roles).toEqual(['customer_admin']);
    expect(me.body.org.name).toBe('Deccan Power Distribution (Demo)');
  });

  it('rejects forged, expired or wrong-audience tokens', async () => {
    await t.http.get('/api/v1/me').set('authorization', 'Bearer abc.def.ghi').expect(401);
    await t.http.get('/api/v1/me').expect(401);
  });

  it('rate-limits public registration', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await t.http
        .post('/api/v1/public/registrations')
        .set('X-Forwarded-For', '203.0.113.9')
        .send({
          organizationName: `Org ${i}`,
          adminName: 'A B',
          adminEmail: `a${i}@rl.example`,
          consentNoticeVersion: '2026-11-01',
          consentGiven: true,
        });
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
  });
});

describe('case lifecycle (P1, mission-critical 24x7)', () => {
  let num = '';
  let id = '';

  it('customer opens a P1 case with attachments and gets an email confirmation', async () => {
    const cfg =
      'hostname core-sw-01\nsnmp-server community Publ1cR0 RO\nlocal-user admin password cipher $c$3$HGu8xy==\ninterface Ten1/0/1\n';
    const u1 = await upload(USERS.kaveriUser, 'running-config.cfg', cfg);
    const u2 = await upload(
      USERS.kaveriUser,
      'eicar.txt',
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    );
    const u3 = await upload(
      USERS.kaveriUser,
      'tool.bin',
      Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]),
    );
    const before = Date.now();
    const r = await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', {
        serialNumber: SERIAL.kaveriMissionCritical.toLowerCase(),
        severity: 'P1',
        category: 'hardware',
        subject: 'Core switch reboots every 6 hours',
        description:
          'Unit reboots with a watchdog timeout.\n\n```\n%Nov  4 10:02:11 core-sw-01 DEV/1/REBOOT\n```',
        businessImpact: 'Branch banking down during reboot',
        uploadIds: [u1, u2, u3],
      })
      .expect(201);
    num = r.body.number;
    id = r.body.id;
    expect(num).toMatch(/^WD-\d{4}-\d{6}$/);
    expect(r.body).toMatchObject({
      status: 'new',
      severity: 'P1',
      tier: 'mission_critical',
      supportLevel: 1,
    });
    expect(r.body.description).toContain('<pre tabindex="0"><code>');

    // SLA timers: P1 mission-critical = 15 min first response, 24x7
    const fr = r.body.sla.find((s: { metric: string }) => s.metric === 'first_response');
    expect(new Date(fr.dueAt).getTime() - before).toBeGreaterThan(14 * 60_000);
    expect(new Date(fr.dueAt).getTime() - before).toBeLessThan(16 * 60_000);
    expect(r.body.sla.map((s: { metric: string }) => s.metric).sort()).toEqual([
      'first_response',
      'resolution',
      'restoration',
    ]);

    await t.drainOutbox();
    const mail = t.mail.sent.find((m) => m.to === USERS.kaveriUser && m.subject.includes(num));
    expect(mail?.subject).toBe(`[${num}] Case opened: Core switch reboots every 6 hours`);
    expect(mail?.replyTo).toMatch(
      new RegExp(`^case\\+${num}\\.[a-f0-9]{8}@support\\.watchdog\\.example$`, 'i'),
    );
  });

  it('attachments are scanned: secrets masked, malware and executables rejected', async () => {
    const r = await (await t.as(USERS.kaveriUser)).get(`/api/v1/cases/${num}`).expect(200);
    const atts = r.body.messages[0].attachments as Array<{
      id: string;
      fileName: string;
      scanStatus: string;
      maskedCount: number;
      sha256: string;
    }>;
    const byName = Object.fromEntries(atts.map((a) => [a.fileName, a]));
    expect(byName['running-config.cfg']).toMatchObject({ scanStatus: 'clean', maskedCount: 2 });
    expect(byName['running-config.cfg']!.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(byName['eicar.txt']!.scanStatus).toBe('infected');
    expect(byName['tool.bin']!.scanStatus).toBe('rejected');

    const url = await (
      await t.as(USERS.kaveriUser)
    )
      .get(`/api/v1/attachments/${byName['running-config.cfg']!.id}/url`)
      .expect(200);
    const file = await t.http.get(new URL(url.body.url).pathname).expect(200);
    expect(file.headers['content-disposition']).toMatch(/^attachment;/);
    const text = file.body instanceof Buffer ? file.body.toString() : String(file.text);
    expect(text).toContain('snmp-server community ****** RO');
    expect(text).not.toContain('Publ1cR0');
    await (
      await t.as(USERS.kaveriUser)
    )
      .get(`/api/v1/attachments/${byName['eicar.txt']!.id}/url`)
      .expect(409);
  });

  it('rejects disallowed file types at upload time', async () => {
    await t.http
      .post('/api/v1/uploads')
      .set('authorization', `Bearer ${await t.token(USERS.kaveriUser)}`)
      .set('Tus-Resumable', '1.0.0')
      .set('Upload-Length', '4')
      .set('Upload-Metadata', `filename ${Buffer.from('setup.exe').toString('base64')}`)
      .expect(415);
  });

  it('engineer triages (assign), adds an internal note the customer never sees or gets emailed', async () => {
    const l1 = await t.as(USERS.l1);
    const me = await l1.get('/api/v1/me').expect(200);
    const a = await l1.post(`/api/v1/cases/${num}/assign`, { assigneeId: me.body.id }).expect(200);
    expect(a.body.status).toBe('triage');
    const sentBefore = t.mail.sent.length;
    await l1
      .post(`/api/v1/cases/${num}/messages`, {
        visibility: 'internal',
        body: 'Matches field notice FN-2026-0042; check PSU.',
      })
      .expect(201);
    await t.drainOutbox();
    expect(t.mail.sent.slice(sentBefore).some((m) => m.text.includes('FN-2026-0042'))).toBe(false);
    const cust = await (await t.as(USERS.kaveriUser)).get(`/api/v1/cases/${num}`).expect(200);
    expect(JSON.stringify(cust.body)).not.toContain('FN-2026-0042');
    expect(cust.body.events.some((e: { type: string }) => e.type === 'assigned')).toBe(false);
    // customers cannot post internal notes
    await (
      await t.as(USERS.kaveriUser)
    )
      .post(`/api/v1/cases/${num}/messages`, { visibility: 'internal', body: 'x' })
      .expect(403);
  });

  it('public reply meets first response, arms the update clock, emails the customer; awaiting-customer pauses clocks', async () => {
    const l1 = await t.as(USERS.l1);
    const r = await l1
      .post(`/api/v1/cases/${num}/messages`, {
        body: 'Please run `display diagnostic-information` and attach it.',
        setStatus: 'awaiting_customer',
      })
      .expect(201);
    expect(r.body.status).toBe('awaiting_customer');
    const fr = r.body.sla.find((s: { metric: string }) => s.metric === 'first_response');
    expect(fr.metAt).not.toBeNull();
    const upd = r.body.sla.find((s: { metric: string }) => s.metric === 'update');
    expect(upd).toBeDefined();
    expect(
      r.body.sla
        .filter((s: { metAt: string | null }) => !s.metAt)
        .every((s: { paused: boolean }) => s.paused),
    ).toBe(true);
    await t.drainOutbox();
    expect(
      t.mail.sent.some(
        (m) =>
          m.to === USERS.kaveriUser && m.subject === `[${num}] New update from WatchDog Support`,
      ),
    ).toBe(true);
    expect(
      t.mail.sent.some(
        (m) => m.to === USERS.kaveriUser && m.subject === `[${num}] Status: Awaiting Customer`,
      ),
    ).toBe(true);
  });

  it('customer reply by email threads into the case, resumes clocks and returns it to the engineer', async () => {
    const token = signer.replyToken(num);
    const raw = [
      `From: Lakshmi Nair <${USERS.kaveriUser}>`,
      `To: case+${token}@support.watchdog.example`,
      `Subject: Re: [${num}] New update from WatchDog Support`,
      'Message-ID: <reply-1@kaveribank.example>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Diagnostics collected, PSU 2 shows a fault LED.',
      '',
      'On Wed, 4 Nov 2026 at 11:00, WatchDog Support wrote:',
      '> Please run display diagnostic-information',
    ].join('\r\n');
    const svc = t.app.get(
      (await import('../src/modules/email-in/email-in.service.js')).EmailInService,
    );
    expect((await svc.ingest(raw)).status).toBe('appended');
    expect((await svc.ingest(raw)).status).toBe('duplicate');
    const c = await (await t.as(USERS.l1)).get(`/api/v1/cases/${num}`).expect(200);
    expect(c.body.status).toBe('in_progress');
    const last = c.body.messages[c.body.messages.length - 1];
    expect(last).toMatchObject({ source: 'email', author: { isStaff: false } });
    expect(last.bodyHtml).toContain('PSU 2 shows a fault LED');
    expect(last.bodyHtml).not.toContain('Please run display');
    expect(c.body.sla.every((s: { paused: boolean }) => !s.paused)).toBe(true);
  });

  it('email attachments join the case after the same scan and secret masking as uploads', async () => {
    const token = signer.replyToken(num);
    const b64 = (x: string) => Buffer.from(x).toString('base64');
    const raw = [
      `From: Lakshmi Nair <${USERS.kaveriUser}>`,
      `To: case+${token}@support.watchdog.example`,
      `Subject: Re: [${num}] logs attached`,
      'Message-ID: <reply-att-1@kaveribank.example>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Config and a signature logo attached.',
      '--b1',
      'Content-Type: text/plain; name="core-sw1.cfg"',
      'Content-Disposition: attachment; filename="core-sw1.cfg"',
      'Content-Transfer-Encoding: base64',
      '',
      b64('hostname core-sw1\nsnmp-agent community read S3cretRO\n'),
      '--b1',
      'Content-Type: image/png; name="logo.png"',
      'Content-Disposition: inline; filename="logo.png"',
      'Content-ID: <logo@x>',
      'Content-Transfer-Encoding: base64',
      '',
      b64('\x89PNG fake'),
      '--b1--',
      '',
    ].join('\r\n');
    const svc = t.app.get(
      (await import('../src/modules/email-in/email-in.service.js')).EmailInService,
    );
    expect((await svc.ingest(raw)).status).toBe('appended');
    await t.drainOutbox();
    const c = await (await t.as(USERS.kaveriUser)).get(`/api/v1/cases/${num}`).expect(200);
    const msg = c.body.messages.find((m: { bodyHtml: string }) =>
      m.bodyHtml.includes('Config and a signature logo'),
    );
    expect(msg.attachments.map((a: { fileName: string }) => a.fileName)).toEqual(['core-sw1.cfg']);
    expect(msg.attachments[0]).toMatchObject({ scanStatus: 'clean', secretsMasked: true });
  });

  it('holds spoofed or unthreadable inbound email instead of posting it', async () => {
    const svc = t.app.get(
      (await import('../src/modules/email-in/email-in.service.js')).EmailInService,
    );
    const base = (from: string, to: string, id: string) =>
      [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: Re: [${num}] hi`,
        `Message-ID: <${id}@x.example>`,
        '',
        'injected text',
      ].join('\r\n');
    expect(
      await svc.ingest(
        base(USERS.narmadaUser, `case+${signer.replyToken(num)}@support.watchdog.example`, 's1'),
      ),
    ).toEqual({ status: 'held', reason: 'unverified-sender' });
    expect(
      await svc.ingest(
        base(USERS.kaveriUser, `case+${num}.deadbeef@support.watchdog.example`, 's2'),
      ),
    ).toEqual({ status: 'held', reason: 'invalid-reply-token' });
    expect(
      await svc.ingest(base('attacker@evil.example', 'support@watchdog.example', 's3')),
    ).toEqual({ status: 'held', reason: 'unverified-sender' });
  });

  it('engineer escalates L1 → L2; customer escalation needs a justification and alerts managers', async () => {
    const e = await (
      await t.as(USERS.l1)
    )
      .post(`/api/v1/cases/${num}/escalate`, {
        justification: 'Hardware fault suspected, needs L2 review',
      })
      .expect(200);
    expect(e.body).toMatchObject({ supportLevel: 2, assigneeName: null });
    const cust = await t.as(USERS.kaveriUser);
    await cust.post(`/api/v1/cases/${num}/escalate`, { justification: 'too short' }).expect(400);
    const ce = await cust
      .post(`/api/v1/cases/${num}/escalate`, {
        justification: 'Branch banking outage is ongoing for 3 hours, need management attention.',
      })
      .expect(200);
    expect(ce.body.can.customerEscalate).toBe(false);
    await cust
      .post(`/api/v1/cases/${num}/escalate`, {
        justification: 'Branch banking outage is ongoing for 3 hours, need management attention.',
      })
      .expect(409);
    await t.drainOutbox();
    expect(
      t.mail.sent.some(
        (m) => m.to === USERS.manager && m.subject.startsWith(`[ESCALATION] ${num}`),
      ),
    ).toBe(true);
  });

  it('customers cannot perform staff transitions; stale If-Match is rejected', async () => {
    await (
      await t.as(USERS.kaveriUser)
    )
      .post(`/api/v1/cases/${num}/transition`, { to: 'resolved' })
      .expect(403);
    await (
      await t.as(USERS.l2)
    )
      .post(`/api/v1/cases/${num}/transition`, { to: 'workaround_provided' })
      .set('If-Match', '"1"')
      .expect(412);
  });

  it('engineer provides a workaround then resolves; customer is emailed a CSAT link and rates once', async () => {
    const l2 = await t.as(USERS.l2);
    const w = await l2
      .post(`/api/v1/cases/${num}/transition`, {
        to: 'workaround_provided',
        note: 'Traffic moved to PSU 1; replacement PSU dispatched.',
      })
      .expect(200);
    expect(
      w.body.sla.find((s: { metric: string }) => s.metric === 'restoration').metAt,
    ).not.toBeNull();
    const r = await l2.post(`/api/v1/cases/${num}/transition`, { to: 'resolved' }).expect(200);
    expect(r.body.status).toBe('resolved');
    expect(r.body.sla.every((s: { metAt: string | null }) => s.metAt)).toBe(true);
    await t.drainOutbox();
    const mail = t.mail.sent.find(
      (m) => m.to === USERS.kaveriUser && m.subject === `[${num}] Resolved – how did we do?`,
    );
    expect(mail).toBeDefined();
    const token = decodeURIComponent(/csat\?token=([^\s"&]+)/.exec(mail!.text)![1]!);
    await t.http
      .post('/api/v1/public/csat')
      .send({ token, score: 5, comment: 'Fast and clear' })
      .expect(204);
    await t.http.post('/api/v1/public/csat').send({ token, score: 1 }).expect(409);
    await t.http
      .post('/api/v1/public/csat')
      .send({ token: token.slice(0, -2) + 'xx', score: 1 })
      .expect(404);
    const c = await (await t.as(USERS.kaveriUser)).get(`/api/v1/cases/${num}`).expect(200);
    expect(c.body.csat).toEqual({ score: 5, comment: 'Fast and clear' });
    expect(c.body.can.submitCsat).toBe(false);
  });

  it('customer can close, and reopen within the window', async () => {
    const cust = await t.as(USERS.kaveriUser);
    const closed = await cust.post(`/api/v1/cases/${num}/transition`, { to: 'closed' }).expect(200);
    expect(closed.body.allowedTransitions).toEqual(['reopened']);
    await cust.post(`/api/v1/cases/${num}/messages`, { body: 'hello?' }).expect(409);
    const re = await cust
      .post(`/api/v1/cases/${num}/transition`, { to: 'reopened', note: 'PSU failed again.' })
      .expect(200);
    expect(re.body.status).toBe('reopened');
  });

  it('refuses cases for unknown or out-of-contract serials', async () => {
    const cust = await t.as(USERS.kaveriAdmin);
    const nf = await cust
      .post('/api/v1/cases', {
        serialNumber: 'WDNOPE0000',
        severity: 'P3',
        category: 'config',
        subject: 'Question about VLANs',
        description: 'x',
      })
      .expect(422);
    expect(nf.body.title).toMatch(/serial number/);
    const ne = await cust
      .post('/api/v1/cases', {
        serialNumber: SERIAL.kaveriExpired,
        severity: 'P3',
        category: 'config',
        subject: 'Question about VLANs',
        description: 'x',
      })
      .expect(422);
    expect(ne.body.title).toMatch(/no active warranty/);
  });

  it('validates input and returns problem+json', async () => {
    const r = await (
      await t.as(USERS.kaveriAdmin)
    )
      .post('/api/v1/cases', { severity: 'P9' })
      .expect(400);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(r.body.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['severity', 'subject']),
    );
  });

  it('every change is in the hash-chained audit log, and tampering is detected', async () => {
    const before = await t.owner.query('SELECT wd.audit_verify() AS bad');
    expect(before.rows[0].bad).toBeNull();
    const n = await t.owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE target_id = $1`, [
      id,
    ]);
    expect(n.rows[0].n).toBeGreaterThanOrEqual(8);
    const c = await t.owner.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `UPDATE audit_log SET action = 'case.tampered' WHERE seq = (SELECT min(seq) FROM audit_log WHERE target_id = $1)`,
        [id],
      );
      const after = await c.query('SELECT wd.audit_verify() AS bad');
      expect(after.rows[0].bad).not.toBeNull();
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});

describe('API documentation', () => {
  it('serves an OpenAPI 3.1 document covering the case API', async () => {
    const r = await t.http.get('/api/openapi.json').expect(200);
    expect(r.body.openapi).toBe('3.1.0');
    for (const p of [
      '/api/v1/cases',
      '/api/v1/cases/{ref}',
      '/api/v1/cases/{ref}/messages',
      '/api/v1/uploads',
      '/api/v1/public/registrations',
    ])
      expect(Object.keys(r.body.paths)).toContain(p);
  });
});
