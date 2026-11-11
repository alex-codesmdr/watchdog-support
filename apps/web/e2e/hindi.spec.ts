import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('the language switch shows the portal in Hindi and back in English', async ({ page }) => {
  await signIn(page, 'noc@kaveribank.example', '/portal');
  await page.getByLabel('Language / भाषा').selectOption('hi');
  await expect(page.getByRole('heading', { level: 1, name: 'खुले case' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi-IN');
  await page.goto('/portal/cases/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Case खोलें' })).toBeVisible();
  await expect(page.getByLabel('सीरियल नंबर')).toBeVisible();
  await page.getByLabel('Language / भाषा').selectOption('en');
  await expect(page.getByRole('heading', { level: 1, name: 'Open a case' })).toBeVisible();
});
