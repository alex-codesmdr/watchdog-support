import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn, signOut } from './helpers';

/** Phase 4a: a customer requests a replacement; the RMA coordinator takes it to closure. */
test.describe.configure({ mode: 'serial' });
let rma = '';
let serial = '';
const run = Date.now().toString(36).toUpperCase().slice(-6);

const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
};

test('customer opens a case and requests a replacement', async ({ page }) => {
  // Register a fresh device for this run: the flow retires the faulty unit, so demo devices stay intact.
  serial = `WDE2EFW${run}`;
  await signIn(page, 'rohan.manager@watchdog.example', '/admin/imports');
  await page.getByLabel('Spreadsheet').setInputFiles({
    name: 'rma-device.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'organisation,serial_number,sku,coverage_kind,coverage_tier,coverage_start,coverage_end',
        `Kaveri Cooperative Bank (Demo),${serial},WD-FW3100,amc,premium,2026-01-01,2028-12-31`,
      ].join('\n'),
    ),
  });
  await page.getByRole('button', { name: 'Check file' }).click();
  await page.getByRole('button', { name: 'Import 1 device' }).click();
  await expect(page.getByText('Imported rma-device.csv')).toBeVisible();
  await page.goto('/workspace');
  await signOut(page);

  await signIn(page, 'it.admin@kaveribank.example');
  await page.goto('/portal/cases/new');
  await page.getByLabel(/Serial number/).fill(serial);
  await expect(page.getByText(/Covered by/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/P2/).check();
  await page.getByLabel(/Category/).selectOption('hardware');
  await page.getByLabel(/^Subject/).fill(`Firewall port 3 dead ${run}`);
  await page
    .getByLabel(/What is happening/)
    .fill('No link on port 3 with known-good cable and SFP.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Open case' }).click();
  await expect(page.getByRole('heading', { name: `Firewall port 3 dead ${run}` })).toBeVisible();

  const panel = page.getByRole('region', { name: 'Replacement (RMA)' });
  const existing = panel.getByRole('link', { name: /RMA-/ });
  await panel.getByRole('button', { name: 'Request a replacement' }).click();
  const d = page.getByRole('dialog', { name: 'Request a replacement' });
  await d.getByLabel(/What is wrong/).fill('Port 3 PHY dead: no link with any cable.');
  await d.getByLabel(/Contact name/).fill('Suresh Gowda');
  await d.getByLabel(/Contact phone/).fill('+91 80 4000 2000');
  await d.getByLabel(/Delivery address/).fill('Kaveri Bhavan, 12 MG Road');
  await d.getByLabel('City').fill('Bengaluru');
  await d.getByLabel('State').fill('Karnataka');
  await d.getByLabel('PIN code').fill('560001');
  await axe(page);
  await d.getByRole('button', { name: 'Send request' }).click();
  // An earlier run may already hold the device's single open RMA: then the API says so.
  const conflict = d.getByText(/is already open for this device/);
  await expect(existing.first().or(conflict)).toBeVisible();
  if (await conflict.isVisible()) {
    rma = (await conflict.textContent())!.match(/RMA-\d{4}-\d{6}/)![0];
    await d.getByRole('button', { name: 'Cancel' }).click();
  } else rma = (await existing.first().textContent())!.trim();
  await page.goto(`/portal/rmas/${rma}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(serial);
  await axe(page);
  await page.goto('/portal');
  await signOut(page);
});

test('RMA coordinator approves, receives, ships the replacement and closes', async ({ page }) => {
  await signIn(page, 'arjun.rma@watchdog.example', '/workspace');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Replacements' })
    .click();
  await page.getByRole('link', { name: rma }).click();
  await axe(page);
  const step = async (label: string, fill?: Record<string, string>) => {
    await page.getByRole('button', { name: label, exact: true }).first().click();
    if (fill) {
      for (const [k, v] of Object.entries(fill)) await page.getByLabel(new RegExp(k)).fill(v);
      await page.getByRole('button', { name: label, exact: true }).last().click();
    }
  };
  const status = page.locator('main header');
  if (await page.getByRole('button', { name: 'Approve' }).isVisible()) await step('Approve');
  await expect(status).toContainText('Approved');
  await step('Faulty unit sent', { 'Tracking number': `BD${run}01` });
  await expect(status).toContainText('Faulty unit on its way');
  await step('Mark faulty unit received');
  await expect(status).toContainText('Faulty unit received');
  await step('Ship replacement', {
    'Replacement serial number': `WDFW31R${run}`,
    'Tracking number': `BD${run}02`,
  });
  await expect(status).toContainText('Replacement shipped');
  await step('Close RMA');
  await expect(status).toContainText('Closed');
  await page.goto('/workspace');
  await signOut(page);
});
