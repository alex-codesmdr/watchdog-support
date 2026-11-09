import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn, signOut } from './helpers';

test('support manager opens and resolves an incident shown on the public status page', async ({
  page,
  browser,
  baseURL,
}) => {
  const title = `Case emails delayed ${Date.now().toString(36)}`;
  await signIn(page, 'rohan.manager@watchdog.example', '/workspace');
  await page.goto('/admin/status');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Title').fill(title);
  await page.getByRole('group', { name: 'Services affected' }).getByLabel('Case email').check();
  await page
    .getByLabel('First update for customers')
    .fill('Case emails are arriving up to 20 minutes late. Cases are not affected.');
  await page.getByRole('button', { name: 'Open incident' }).click();
  await expect(page.getByText(`Incident opened: ${title}`)).toBeVisible();

  const ctx = await browser.newContext({ baseURL });
  const v = await ctx.newPage();
  await expect(async () => {
    await v.goto('/status');
    await expect(v.getByRole('heading', { name: title })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  await expect(v.getByRole('status')).toContainText('slower than usual');
  const r = await new AxeBuilder({ page: v }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((x) => x.id)).toEqual([]);
  await ctx.close();

  const form = page.locator('form', { hasText: title });
  await form.getByLabel('New status').selectOption('resolved');
  await form.getByLabel('Update for customers').fill('Emails are on time again.');
  await form.getByRole('button', { name: 'Post update' }).click();
  await expect(page.getByText(`Update posted: ${title}`)).toBeVisible();
  await signOut(page);
});
