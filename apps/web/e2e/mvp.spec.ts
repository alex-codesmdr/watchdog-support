import { expect, test } from '@playwright/test';
import { signIn, signOut } from './helpers';

/**
 * Critical flow (acceptance criteria 1–2 through the browser): customer opens a P1 case with an
 * attachment and sees SLA timers; an engineer adds an internal note and replies; the customer sees
 * the reply but never the note.
 */
test.describe.configure({ mode: 'serial' });
let caseUrlPath = '';
let caseNumber = '';

test('customer opens a P1 case with an attachment', async ({ page }) => {
  await signIn(page, 'noc@kaveribank.example');
  await page.getByRole('link', { name: 'Open a case' }).first().click();
  await page.getByLabel(/Serial number/).fill('WDSW5600A0001');
  await expect(page.getByText(/Covered by Mission-Critical 24×7/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel(/P1 – Critical/).check();
  await page.getByLabel(/Category/).selectOption('hardware');
  await page.getByLabel(/^Subject/).fill('Core switch reboots every 6 hours');
  await page
    .getByLabel(/What is happening/)
    .fill('Unit reboots with a watchdog timeout.\n\n```\n%DEV/1/REBOOT: Board 1 restarted\n```');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'running-config.cfg',
      mimeType: 'text/plain',
      buffer: Buffer.from('hostname core\nsnmp-server community S3cret RO\n'),
    });
  await expect(page.getByText('Uploaded')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Open case' }).click();

  await expect(
    page.getByRole('heading', { name: 'Core switch reboots every 6 hours' }),
  ).toBeVisible();
  await expect(page.getByText(/is open/)).toBeVisible();
  await expect(page.getByRole('meter', { name: /First response/ })).toBeVisible();
  caseUrlPath = new URL(page.url()).pathname;
  caseNumber = caseUrlPath.split('/').pop()!;
  // the scan worker masks the secret
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/secret masked/)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await signOut(page);
});

test('engineer triages, adds an internal note and replies', async ({ page }) => {
  await signIn(page, 'asha.l1@watchdog.example', '/workspace');
  await page.goto(`/workspace/cases/${caseNumber}`);
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await expect(page.getByText('Engineer: Asha Menon')).toBeVisible();

  await page.getByRole('radio', { name: 'Internal note' }).click();
  await page
    .getByLabel('Internal note', { exact: true })
    .fill('Matches FN-2026-0042, PSU firmware.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Internal note (not visible to customer)')).toBeVisible();

  await page.getByRole('radio', { name: 'Reply to customer' }).click();
  await page
    .getByLabel('Reply to customer', { exact: true })
    .fill('Please check the PSU 2 LED and send `display power`.');
  await page.getByRole('combobox').selectOption('awaiting_customer');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText('Awaiting Customer').first()).toBeVisible();
  await signOut(page);
});

test('customer sees the reply but never the internal note', async ({ page }) => {
  await signIn(page, 'noc@kaveribank.example');
  await page.goto(caseUrlPath);
  await expect(page.getByText('Please check the PSU 2 LED')).toBeVisible();
  await expect(page.getByText('FN-2026-0042')).toHaveCount(0);
  await expect(page.getByText(/Paused/).first()).toBeVisible();
});

test('another organisation gets "not found" for the case', async ({ page }) => {
  await signIn(page, 'netops@narmadacity.example');
  await page.goto(caseUrlPath);
  await expect(page.getByRole('heading', { name: 'We could not find that page' })).toBeVisible();
});
