import { expect, test } from '@playwright/test';

test('a visitor switches to dark mode and it is remembered', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
  await expect(async () => {
    await page.getByLabel('Colour theme').selectOption('dark');
    await expect(html).toHaveAttribute('data-theme', 'dark', { timeout: 1000 });
  }).toPass();
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('Colour theme')).toHaveValue('dark');
  await page.getByLabel('Colour theme').selectOption('system');
  await page.reload();
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
});
