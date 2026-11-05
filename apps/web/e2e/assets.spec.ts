import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn, signOut } from './helpers';

/** Phase 3d: customer admin manages sites and asks for a renewal; staff import devices. */
test.describe.configure({ mode: 'serial' });
const run = Date.now().toString(36).toUpperCase();

const axe = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
};

test('customer admin adds a site, moves a device and requests a renewal quote', async ({
  page,
}) => {
  await signIn(page, 'it.admin@kaveribank.example');
  await page.getByRole('link', { name: 'Devices' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Devices' })).toBeVisible();
  await axe(page);

  const site = `Belagavi Branch ${run}`;
  await page.getByRole('button', { name: 'Add a site' }).click();
  await page.getByLabel(/Site name/).fill(site);
  await page.getByLabel('City').fill('Belagavi');
  await page.getByLabel('PIN code').fill('590001');
  await page.getByRole('button', { name: 'Add site' }).click();
  await expect(page.getByRole('region', { name: 'Sites' }).getByText(site)).toBeVisible();
  // Let the page refresh that follows adding a site settle, or it can reset the dialog's choice.
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Change the site of WDFW3100B0002' }).click();
  const dlg = page.getByRole('dialog', { name: 'Change site' });
  await dlg.getByLabel('Site').selectOption({ label: `${site}, Belagavi` });
  await expect(dlg.getByLabel('Site').locator('option:checked')).toHaveText(`${site}, Belagavi`);
  await dlg.getByRole('button', { name: 'Save site' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('li', { hasText: 'WDFW3100B0002' })).toContainText(site);

  // The expired device needs attention; the quote can only be requested once.
  const row = page.locator('li', { hasText: 'WDSW3100D0004' });
  const ask = row.getByRole('button', { name: /Request a renewal quote/ });
  await expect(ask.or(row.getByText('Quote requested'))).toBeVisible();
  if (await ask.isVisible()) {
    await ask.click();
    const r = page.getByRole('dialog', { name: 'Request a renewal quote' });
    await r.getByLabel('Support level').selectOption('premium');
    await r.getByLabel('Anything we should know').fill('Three-year quote please');
    await r.getByRole('button', { name: 'Request quote' }).click();
    await expect(page.getByText(/Renewal quote requested for WDSW3100D0004/)).toBeVisible();
  }
  await expect(row.getByText('Quote requested')).toBeVisible();
  await signOut(page);
});

test('a regular customer user sees devices but cannot change sites', async ({ page }) => {
  await signIn(page, 'noc@kaveribank.example', '/portal');
  await page.goto('/portal/assets');
  await expect(page.getByRole('heading', { level: 1, name: 'Devices' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a site' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Change the site/ })).toHaveCount(0);
  await signOut(page);
});

test('support manager checks and imports a device spreadsheet', async ({ page }) => {
  await signIn(page, 'rohan.manager@watchdog.example', '/workspace');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' }).click();
  await page.getByRole('link', { name: 'Device import' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Device import' })).toBeVisible();
  await axe(page);

  const serial = `WDE2E${run}`.slice(0, 32);
  const csv = [
    'organisation,serial_number,sku,site,coverage_kind,coverage_tier,coverage_start,coverage_end',
    `Kaveri Cooperative Bank (Demo),${serial},WD-AP720,Head Office,warranty,standard,01/01/2026,31/12/2028`,
    'Kaveri Cooperative Bank (Demo),BAD,WD-AP720,,,,,',
  ].join('\n');
  await page.getByLabel('Spreadsheet').setInputFiles({
    name: 'devices.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('Check complete: 2 rows in devices.csv')).toBeVisible();
  await expect(page.getByRole('cell', { name: /Serial number must be/ })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 device' }).click();
  await expect(page.getByText('Imported devices.csv')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'devices.csv' }).first()).toBeVisible();
  await signOut(page);
});
