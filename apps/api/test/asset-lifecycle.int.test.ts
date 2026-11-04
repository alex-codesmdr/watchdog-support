/**
 * Phase 3d: sites, moving devices, renewal requests, bulk import and coverage-expiry reminders.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../src/modules/assets/asset-import.js';
import { parseDate } from '../src/modules/assets/asset-import.controller.js';
import { RemindersService } from '../src/modules/assets/reminders.service.js';
import { createTestApp, ORG, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const KAVERI = 'Kaveri Cooperative Bank (Demo)';
const upload = async (who: string, csv: string, dryRun: boolean, status: number) =>
  t.http
    .post(`/api/v1/admin/asset-imports?dryRun=${dryRun}&fileName=devices.csv`)
    .set('authorization', `Bearer ${await t.token(who)}`)
    .set('content-type', 'text/csv')
    .send(csv)
    .expect(status);
const assetId = async (serial: string) =>
  (await t.owner.query<{ id: string }>('SELECT id FROM asset WHERE serial_number = $1', [serial]))
    .rows[0]!.id;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

describe('parsing helpers', () => {
  it('parses quoted CSV with commas, quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });
  it('accepts ISO and Indian day-first dates and rejects impossible ones', () => {
    expect(parseDate('2026-02-28')).toBe('2026-02-28');
    expect(parseDate('31/01/2026')).toBe('2026-01-31');
    expect(parseDate('5-3-2026')).toBe('2026-03-05');
    expect(parseDate('31/02/2026')).toBe('invalid');
    expect(parseDate(undefined)).toBeNull();
  });
});

describe('sites', () => {
  let siteId: string;

  it('customer admin creates, renames and lists sites of their own organisation', async () => {
    const admin = await t.as(USERS.kaveriAdmin);
    const r = await admin
      .post('/api/v1/sites', {
        name: 'Mysuru DR',
        city: 'Mysuru',
        state: 'Karnataka',
        pincode: '570001',
      })
      .expect(201);
    siteId = r.body.id;
    expect(r.body).toMatchObject({ orgId: ORG.kaveri, assetCount: 0 });
    await admin.post('/api/v1/sites', { name: 'Mysuru DR' }).expect(409);
    await t.http
      .patch(`/api/v1/sites/${siteId}`)
      .set('authorization', `Bearer ${await t.token(USERS.kaveriAdmin)}`)
      .send({ name: 'Mysuru Disaster Recovery', city: 'Mysuru' })
      .expect(200);
    const list = await admin.get('/api/v1/sites').expect(200);
    expect(list.body.items.map((s: { name: string }) => s.name)).toContain(
      'Mysuru Disaster Recovery',
    );
    expect(list.body.items.every((s: { orgId: string }) => s.orgId === ORG.kaveri)).toBe(true);
  });

  it('a regular customer user cannot change sites', async () => {
    const user = await t.as(USERS.kaveriUser);
    await user.post('/api/v1/sites', { name: 'Not allowed' }).expect(403);
  });

  it('another organisation cannot see, rename or delete the site', async () => {
    const other = await t.as(USERS.narmadaAdmin);
    const list = await other.get('/api/v1/sites').expect(200);
    expect(list.body.items.find((s: { id: string }) => s.id === siteId)).toBeUndefined();
    const tok = await t.token(USERS.narmadaAdmin);
    await t.http
      .patch(`/api/v1/sites/${siteId}`)
      .set('authorization', `Bearer ${tok}`)
      .send({ name: 'x1' })
      .expect(404);
    await t.http
      .delete(`/api/v1/sites/${siteId}`)
      .set('authorization', `Bearer ${tok}`)
      .expect(404);
  });

  it('moves a device to the site; a site in use cannot be deleted; a foreign site is refused', async () => {
    const tok = await t.token(USERS.kaveriAdmin);
    const id = await assetId(SERIAL.kaveriPremium);
    await t.http
      .patch(`/api/v1/assets/${id}`)
      .set('authorization', `Bearer ${tok}`)
      .send({ siteId })
      .expect(200);
    await t.http
      .delete(`/api/v1/sites/${siteId}`)
      .set('authorization', `Bearer ${tok}`)
      .expect(409);

    const n = await t.as(USERS.narmadaAdmin);
    const foreign = await n.post('/api/v1/sites', { name: 'Narmada annex' }).expect(201);
    await t.http
      .patch(`/api/v1/assets/${id}`)
      .set('authorization', `Bearer ${tok}`)
      .send({ siteId: foreign.body.id })
      .expect(422);
    // Narmada cannot move Kaveri's device at all.
    await t.http
      .patch(`/api/v1/assets/${id}`)
      .set('authorization', `Bearer ${await t.token(USERS.narmadaAdmin)}`)
      .send({ siteId: foreign.body.id })
      .expect(404);
  });
});

describe('renewal requests', () => {
  it('a customer requests a quote once; sales gets an email; duplicates are refused', async () => {
    const id = await assetId(SERIAL.kaveriExpired);
    const user = await t.as(USERS.kaveriUser);
    const before = t.mail.sent.length;
    const r = await user
      .post(`/api/v1/assets/${id}/renewal-request`, {
        desiredTier: 'premium',
        note: 'Please include 3 years',
      })
      .expect(201);
    expect(r.body).toMatchObject({ status: 'requested', serialNumber: SERIAL.kaveriExpired });
    await user.post(`/api/v1/assets/${id}/renewal-request`, {}).expect(409);
    await t.drainOutbox();
    const mail = t.mail.sent.slice(before).find((m) => m.to === 'renewals@watchdog.example');
    expect(mail?.subject).toContain(SERIAL.kaveriExpired);
    expect(mail?.text).toContain('Premium');
    const list = await user.get('/api/v1/renewal-requests').expect(200);
    expect(list.body.items[0]).toMatchObject({ assetId: id });
  });

  it('another organisation cannot request a renewal for, or list, the device', async () => {
    const id = await assetId(SERIAL.kaveriMissionCritical);
    const other = await t.as(USERS.narmadaUser);
    await other.post(`/api/v1/assets/${id}/renewal-request`, {}).expect(404);
    const list = await other.get('/api/v1/renewal-requests').expect(200);
    expect(
      list.body.items.every((x: { serialNumber: string }) => !x.serialNumber.startsWith('WDSW')),
    ).toBe(true);
  });
});

describe('bulk import', () => {
  const header =
    'organisation,serial_number,sku,site,mac,purchase_date,software_version,coverage_kind,coverage_tier,coverage_start,coverage_end,contract_ref';
  const good = [
    `"${KAVERI}",WDIMP000001,WD-AP720,Hubballi Branch,00-1A-2B-3C-4D-01,15/01/2026,7.1.070,warranty,standard,2026-01-15,2029-01-14,PO-1`,
    `"${KAVERI}",wdimp000002,WD-AP720,Hubballi Branch,,2026-01-15,,,,,,`,
  ];
  const bad = [
    `Nobody Ltd,WDIMP000003,WD-AP720,,,,,,,,,`,
    `"${KAVERI}",WDIMP000004,WD-NOPE,,,,,,,,,`,
    `"${KAVERI}",WDIMP000001,WD-AP720,,,,,,,,,`, // duplicate in file
    `"${KAVERI}",${SERIAL.narmadaPremium},WD-RT8800,,,,,,,,,`, // belongs to another org
    `"${KAVERI}",WDIMP000005,WD-AP720,,,,,warranty,gold,2026-01-01,2025-01-01,`,
  ];
  const csv = [header, ...good, ...bad].join('\n');

  it('the template is available to staff with import rights only', async () => {
    const m = await t.as(USERS.manager);
    const r = await m.get('/api/v1/admin/asset-imports/template.csv').expect(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.text.split('\r\n')[0]).toBe(header);
    await (
      await t.as(USERS.kaveriAdmin)
    )
      .get('/api/v1/admin/asset-imports/template.csv')
      .expect(403);
    await (await t.as(USERS.l1)).get('/api/v1/admin/asset-imports/template.csv').expect(403);
  });

  it('a dry run reports every row and changes nothing', async () => {
    const r = await upload(USERS.manager, csv, true, 201);
    expect(r.body).toMatchObject({ dryRun: true, totalRows: 7, created: 2, failed: 5 });
    const byRow = new Map(r.body.rows.map((x: { row: number }) => [x.row, x]));
    expect(byRow.get(4)).toMatchObject({
      status: 'error',
      messages: [expect.stringContaining('No customer organisation')],
    });
    expect(byRow.get(5)).toMatchObject({ messages: [expect.stringContaining('Unknown SKU')] });
    expect(byRow.get(6)).toMatchObject({ messages: ['Duplicate of row 2 in this file'] });
    expect(byRow.get(7)).toMatchObject({
      messages: [expect.stringContaining('different organisation')],
    });
    expect((byRow.get(8) as { messages: string[] }).messages).toEqual(
      expect.arrayContaining([expect.stringContaining('tier'), 'Coverage ends before it starts']),
    );
    const n = await t.owner.query(`SELECT 1 FROM asset WHERE serial_number LIKE 'WDIMP%'`);
    expect(n.rowCount).toBe(0);
    const s = await t.owner.query(`SELECT 1 FROM site WHERE name = 'Hubballi Branch'`);
    expect(s.rowCount).toBe(0);
  });

  it('a real import applies the good rows, skips the bad ones and is idempotent', async () => {
    const r = await upload(USERS.manager, csv, false, 201);
    expect(r.body).toMatchObject({ dryRun: false, created: 2, failed: 5 });
    const a = await t.owner.query<{ org_id: string; mac: string; site: string }>(
      `SELECT a.org_id, a.mac::text, s.name AS site FROM asset a JOIN site s ON s.id = a.site_id WHERE serial_number = 'WDIMP000001'`,
    );
    expect(a.rows[0]).toMatchObject({
      org_id: ORG.kaveri,
      mac: '00:1a:2b:3c:4d:01',
      site: 'Hubballi Branch',
    });
    const e = await t.owner.query(
      `SELECT 1 FROM entitlement e JOIN asset a ON a.id = e.asset_id WHERE a.serial_number = 'WDIMP000001' AND e.contract_ref = 'PO-1'`,
    );
    expect(e.rowCount).toBe(1);

    const again = await upload(USERS.manager, [header, ...good].join('\n'), false, 201);
    expect(again.body).toMatchObject({ created: 0, updated: 0, unchanged: 2, failed: 0 });

    const hist = await (await t.as(USERS.manager)).get('/api/v1/admin/asset-imports').expect(200);
    expect(hist.body.items.length).toBeGreaterThanOrEqual(3);
  });

  it('reports overlapping coverage per row without losing the rest', async () => {
    const r = await upload(
      USERS.manager,
      [
        header,
        `"${KAVERI}",WDIMP000001,WD-AP720,,,,,warranty,standard,2027-01-01,2030-01-01,`,
        `"${KAVERI}",WDIMP000006,WD-AP720,,,,,,,,,`,
      ].join('\n'),
      false,
      201,
    );
    expect(r.body.rows.find((x: { row: number }) => x.row === 2)).toMatchObject({
      status: 'error',
      messages: [expect.stringContaining('overlap')],
    });
    expect(r.body.created).toBe(1);
  });

  it('reads an Excel workbook', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Devices');
    ws.addRow(['Organisation', 'Serial Number', 'SKU', 'Purchase Date']);
    ws.addRow([KAVERI, 'WDIMPXLS0001', 'WD-SRV-2200', new Date(Date.UTC(2026, 0, 20))]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await t.http
      .post('/api/v1/admin/asset-imports?dryRun=false&fileName=devices.xlsx')
      .set('authorization', `Bearer ${await t.token(USERS.sysadmin)}`)
      .set('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .send(buf)
      .expect(201);
    expect(r.body).toMatchObject({ created: 1, failed: 0 });
  });

  it('rejects files with missing columns, and customers or engineers cannot import', async () => {
    const r = await upload(USERS.manager, 'serial_number\nWDIMP0009\n', true, 422);
    expect(r.body.detail).toContain('organisation');
    await upload(USERS.kaveriAdmin, csv, true, 403);
    await upload(USERS.l2, csv, true, 403);
  });
});

describe('coverage expiry reminders', () => {
  it('emails customer admins once per window, skips renewed devices, and never repeats', async () => {
    // Fresh devices with coverage ending in 25 and 75 days, plus one already renewed.
    const tok = (s: string) => `"${KAVERI}",${s},WD-AP720,,,,,`;
    const csv = [
      'organisation,serial_number,sku,site,mac,purchase_date,software_version,coverage_kind,coverage_tier,coverage_start,coverage_end',
      `${tok('WDREM000001')}warranty,standard,2024-01-01,${daysFromNow(25)}`,
      `${tok('WDREM000002')}amc,premium,2024-01-01,${daysFromNow(75)}`,
      `${tok('WDREM000003')}warranty,standard,2024-01-01,${daysFromNow(20)}`,
    ];
    await upload(USERS.manager, csv.join('\n'), false, 201);
    // Device 3 is already renewed: an AMC starts the day after its warranty ends.
    await t.owner.query(
      `INSERT INTO entitlement (org_id, asset_id, kind, tier, starts_on, ends_on)
       SELECT org_id, id, 'amc', 'standard', $1::date, $1::date + 365 FROM asset WHERE serial_number = 'WDREM000003'`,
      [daysFromNow(21)],
    );
    // Existing seed data may fall in the windows too; isolate our assertions to the new serials.
    const svc = t.app.get(RemindersService);
    const before = t.mail.sent.length;
    const first = await svc.run();
    expect(first.entitlements).toBeGreaterThanOrEqual(2);
    await t.drainOutbox();
    const mails = t.mail.sent.slice(before).filter((m) => m.to === USERS.kaveriAdmin);
    const all = mails.map((m) => m.text).join('\n');
    expect(all).toContain('WDREM000001');
    expect(all).toContain('WDREM000002');
    expect(all).not.toContain('WDREM000003');
    expect(mails.find((m) => m.text.includes('WDREM000001'))?.subject).toMatch(/30 days/);
    expect(mails.find((m) => m.text.includes('WDREM000002'))?.subject).toMatch(/90 days/);
    expect(t.mail.sent.slice(before).some((m) => m.to === USERS.kaveriUser)).toBe(false);

    const second = await svc.run();
    expect(second.entitlements).toBe(0);
  });
});
