import { expect, test } from '@playwright/test';

/** Public warranty check in the browser, including the proof-of-work step. @mobile */
test('public warranty check shows coverage and links to a case @mobile', async ({ page }) => {
  await page.goto('/warranty');
  await page.getByLabel('Serial number').fill('wdsw5600a0001');
  await page.getByRole('button', { name: 'Check coverage' }).click();
  await expect(page.getByRole('heading', { name: 'WatchDog CoreLink SW5600-48P' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Active until/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open a case for this device' })).toHaveAttribute(
    'href',
    /serial=WDSW5600A0001/,
  );
});

test('unknown and expired serials are explained', async ({ page }) => {
  await page.goto('/warranty');
  await page.getByLabel('Serial number').fill('WDNOTAREAL9');
  await page.getByRole('button', { name: 'Check coverage' }).click();
  await expect(page.getByText('We could not find WDNOTAREAL9')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Serial number').fill('WDSW3100D0004');
  await page.getByRole('button', { name: 'Check coverage' }).click();
  await expect(page.getByText(/Expired on/)).toBeVisible({ timeout: 15_000 });
});
