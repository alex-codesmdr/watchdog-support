/**
 * Phase 3e: download centre. Visibility levels, entitlement gating, licence acceptance, audit,
 * staff upload with antivirus and checksums.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ORG, USERS, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(() => t.close());

type Rel = {
  id: string;
  title: string;
  version: string;
  access: string;
  visibility: string;
  files: { id: string; fileName: string; sha256: string; ready: boolean }[];
  eula: { id: string; accepted: boolean } | null;
};
const list = async (who?: string, qs = '') => {
  const req = t.http.get(`/api/v1/downloads${qs}`);
  if (who) req.set('authorization', `Bearer ${await t.token(who)}`);
  return (await req.expect(200)).body.items as Rel[];
};
const find = (items: Rel[], title: string, version: string) =>
  items.find((r) => r.title === title && r.version === version);
const link = async (fileId: string, who: string | undefined, status: number) => {
  const req = t.http.post(`/api/v1/downloads/files/${fileId}/link`);
  if (who) req.set('authorization', `Bearer ${await t.token(who)}`);
  return req.expect(status);
};

describe('download centre: who sees what', () => {
  it('visitors see public and gated releases but never internal ones', async () => {
    const items = await list();
    expect(find(items, 'WatchDog enterprise MIBs', '2026.10')?.access).toBe('download');
    expect(find(items, 'CoreLink OS', '7.1.075')?.access).toBe('sign_in');
    expect(find(items, 'AirPack firmware', '2.3.1')?.access).toBe('sign_in');
    expect(items.some((r) => r.visibility === 'internal')).toBe(false);
  });

  it('entitlement follows coverage on a compatible model', async () => {
    // Kaveri has active coverage on a SW5600 (switching) and an FW3100 (security).
    const kaveri = await list(USERS.kaveriUser);
    expect(find(kaveri, 'CoreLink OS', '7.1.075')?.access).toBe('download');
    expect(find(kaveri, 'Sentinel OS', '5.4.2')?.access).toBe('download');
    expect(find(kaveri, 'AirPack firmware', '2.3.1')?.access).toBe('download'); // registered
    // Narmada only has a router: no switch or firewall coverage.
    const narmada = await list(USERS.narmadaUser);
    expect(find(narmada, 'CoreLink OS', '7.1.075')?.access).toBe('entitlement_required');
    expect(find(narmada, 'Sentinel OS', '5.4.2')?.access).toBe('entitlement_required');
  });

  it('staff see internal tools; filters work', async () => {
    const staff = await list(USERS.l2);
    expect(find(staff, 'Field diagnostic collector', '1.4.0')?.access).toBe('download');
    const mibs = await list(undefined, '?kind=mib');
    expect(mibs.every((r) => r.title.includes('MIB'))).toBe(true);
    const q = await list(USERS.kaveriUser, '?q=SW5600');
    expect(q.map((r) => r.title)).toContain('CoreLink OS');
  });

  it('an internal release is invisible to customers even by ID (RLS second wall)', async () => {
    const staff = await list(USERS.l2);
    const tool = find(staff, 'Field diagnostic collector', '1.4.0')!;
    await (await t.as(USERS.kaveriAdmin)).get(`/api/v1/downloads/releases/${tool.id}`).expect(404);
    await link(tool.files[0]!.id, USERS.kaveriAdmin, 404);
    const c = await t.app_.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `SELECT set_config('app.org_id', $1, true), set_config('app.is_internal', 'false', true)`,
        [ORG.kaveri],
      );
      const rows = await c.query(`SELECT 1 FROM software_release WHERE visibility = 'internal'`);
      expect(rows.rowCount).toBe(0);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});

describe('download centre: getting a file', () => {
  it('public files download anonymously and are recorded', async () => {
    const mib = find(await list(), 'WatchDog enterprise MIBs', '2026.10')!;
    const r = await link(mib.files[0]!.id, undefined, 200);
    expect(r.body).toMatchObject({ fileName: 'WATCHDOG-SMI.mib', sha256: mib.files[0]!.sha256 });
    expect(r.body.url).toBeTruthy();
    const ev = await t.owner.query(`SELECT user_id FROM download_event WHERE file_id = $1`, [
      mib.files[0]!.id,
    ]);
    expect(ev.rows.at(-1)).toEqual({ user_id: null });
  });

  it('gated files need sign-in, then entitlement, then the licence', async () => {
    const fw = find(await list(USERS.kaveriUser), 'CoreLink OS', '7.1.075')!;
    const file = fw.files[0]!;
    await link(file.id, undefined, 401);
    const deny = await link(file.id, USERS.narmadaUser, 403);
    expect(deny.body.title).toMatch(/active support contract/);
    const eula = await link(file.id, USERS.kaveriUser, 409);
    expect(eula.body.title).toMatch(/licence/);
    expect(fw.eula?.accepted).toBe(false);

    const tok = await t.token(USERS.kaveriUser);
    await t.http
      .post(`/api/v1/downloads/eulas/${fw.eula!.id}/accept`)
      .set('authorization', `Bearer ${tok}`)
      .expect(204);
    const ok = await link(file.id, USERS.kaveriUser, 200);
    expect(ok.body.sha256).toBe(file.sha256);
    const again = find(await list(USERS.kaveriUser), 'CoreLink OS', '7.1.075')!;
    expect(again.eula?.accepted).toBe(true);
    const audit = await t.owner.query(
      `SELECT 1 FROM audit_log WHERE action = 'download' AND target_id = $1`,
      [file.id],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('the signed link really serves the file with a matching checksum', async () => {
    // Upload through the staff API so the bytes exist in this test's storage.
    const mgr = await t.as(USERS.manager);
    const rel = await mgr
      .post('/api/v1/admin/releases', {
        familyKey: 'routing',
        kind: 'firmware',
        title: 'PathMaster OS',
        version: '9.0.1',
        visibility: 'entitled',
        notesMd: '## Fixed\n- BGP graceful restart timer',
        productSkus: ['WD-RT8800'],
      })
      .expect(201);
    expect(rel.body.status).toBe('draft');
    const body = Buffer.from('PATHMASTER-IMAGE-' + 'x'.repeat(5000));
    // Publishing without a checked file is refused.
    await t.http
      .patch(`/api/v1/admin/releases/${rel.body.id}/status`)
      .set('authorization', `Bearer ${await t.token(USERS.manager)}`)
      .send({ status: 'published' })
      .expect(409);
    const up = await t.http
      .post(`/api/v1/admin/releases/${rel.body.id}/files?fileName=pathmaster-9.0.1.bin`)
      .set('authorization', `Bearer ${await t.token(USERS.manager)}`)
      .set('content-type', 'application/octet-stream')
      .send(body)
      .expect(201);
    expect(up.body.sha256).toBe(createHash('sha256').update(body).digest('hex'));
    await t.drainOutbox(); // antivirus + move out of quarantine
    await t.http
      .patch(`/api/v1/admin/releases/${rel.body.id}/status`)
      .set('authorization', `Bearer ${await t.token(USERS.manager)}`)
      .send({ status: 'published' })
      .expect(200);

    // Narmada has a covered RT8800 → entitled.
    const nar = find(await list(USERS.narmadaUser), 'PathMaster OS', '9.0.1')!;
    expect(nar.access).toBe('download');
    const l = await link(nar.files[0]!.id, USERS.narmadaUser, 200);
    const path = new URL(l.body.url).pathname + new URL(l.body.url).search;
    const dl = await t.http
      .get(path)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(
      createHash('sha256')
        .update(dl.body as Buffer)
        .digest('hex'),
    ).toBe(up.body.sha256);
    // Kaveri has no router coverage.
    expect(find(await list(USERS.kaveriUser), 'PathMaster OS', '9.0.1')?.access).toBe(
      'entitlement_required',
    );
  });

  it('an infected upload never becomes downloadable', async () => {
    const mgr = await t.as(USERS.manager);
    const rel = await mgr
      .post('/api/v1/admin/releases', {
        familyKey: 'routing',
        kind: 'tool',
        title: 'Bad tool',
        version: '0.0.1',
        visibility: 'public',
      })
      .expect(201);
    await t.http
      .post(`/api/v1/admin/releases/${rel.body.id}/files?fileName=bad.bin`)
      .set('authorization', `Bearer ${await t.token(USERS.manager)}`)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'))
      .expect(201);
    await t.drainOutbox();
    const st = await t.owner.query(`SELECT scan_status FROM release_file WHERE release_id = $1`, [
      rel.body.id,
    ]);
    expect(st.rows[0]).toEqual({ scan_status: 'infected' });
    await t.http
      .patch(`/api/v1/admin/releases/${rel.body.id}/status`)
      .set('authorization', `Bearer ${await t.token(USERS.manager)}`)
      .send({ status: 'published' })
      .expect(409);
  });
});

describe('download centre: authoring permissions and validation', () => {
  it('only release managers can create or upload', async () => {
    await (await t.as(USERS.kaveriAdmin)).post('/api/v1/admin/releases', {}).expect(403);
    await (await t.as(USERS.l1)).get('/api/v1/admin/releases').expect(403);
    await (await t.as(USERS.content)).get('/api/v1/admin/releases').expect(200);
  });

  it('rejects unknown models, models from another family and duplicate versions', async () => {
    const mgr = await t.as(USERS.manager);
    const base = {
      familyKey: 'switching',
      kind: 'firmware',
      title: 'CoreLink OS',
      visibility: 'entitled',
    };
    await mgr
      .post('/api/v1/admin/releases', { ...base, version: '7.1.080', productSkus: ['WD-NOPE'] })
      .expect(422);
    await mgr
      .post('/api/v1/admin/releases', { ...base, version: '7.1.080', productSkus: ['WD-RT8800'] })
      .expect(422);
    await mgr.post('/api/v1/admin/releases', { ...base, version: '7.1.075' }).expect(409);
    await t.http
      .post(`/api/v1/admin/releases/00000000-0000-4000-8000-000000000999/files?fileName=../../etc`)
      .set('authorization', `Bearer ${await t.token(USERS.manager)}`)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('x'))
      .expect(422);
  });

  it('release notes are sanitised', async () => {
    const mgr = await t.as(USERS.manager);
    const r = await mgr
      .post('/api/v1/admin/releases', {
        familyKey: 'wireless',
        kind: 'document',
        title: 'AirPack install guide',
        version: '1.0',
        visibility: 'public',
        notesMd: 'Hello <script>alert(1)</script><img src=x onerror=alert(1)>',
      })
      .expect(201);
    expect(r.body.notesHtml).not.toMatch(/<script|onerror/);
  });
});
