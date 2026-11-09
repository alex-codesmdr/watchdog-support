import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('a visitor asks the help assistant and follows a cited article', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Ask the help assistant' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ask WatchDog Support' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Your question').fill('How do I set up a site-to-site IPsec VPN?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Articles used' })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.getByText('Thanks for the feedback.')).toBeVisible();
  await page.getByRole('link', { name: '[1]' }).first().click();
  await expect(page).toHaveURL(/\/kb\//);
});
