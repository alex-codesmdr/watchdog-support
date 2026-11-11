import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const axe = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
};

test('an engineer logs a phone call as a case and sees what might help', async ({ page }) => {
  await signIn(page, 'asha.l1@watchdog.example', '/workspace');
  await page.goto('/workspace/calls/new');
  await expect(async () => {
    await page.getByLabel('Customer').fill('Kaveri');
    await page.getByRole('button', { name: /Kaveri/ }).click({ timeout: 2000 });
  }).toPass();
  await page.getByLabel('Who called').selectOption({ label: 'Lakshmi Nair' });
  await page.getByRole('combobox', { name: /^Device/ }).selectOption({ index: 1 });
  await page.getByLabel('Severity').selectOption('P2');
  await page.getByLabel('Summary').fill('BGP sessions flap every few minutes');
  await page
    .getByLabel('What the caller told you')
    .fill('Two upstream BGP sessions reset every three to five minutes since this morning.');
  await axe(page);
  await page.getByRole('button', { name: 'Open the case' }).click();
  await expect(page).toHaveURL(/\/workspace\/cases\/WD-/);
  await expect(page.getByText(/Reported by phone by Lakshmi Nair/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Might help' })).toBeVisible();
});

test('a support manager sees the dashboard and the call-back list', async ({ page }) => {
  await signIn(page, 'rohan.manager@watchdog.example', '/workspace');
  await page.goto('/workspace/dashboard');
  await expect(page.getByRole('heading', { name: 'Management dashboard' })).toBeVisible();
  await expect(page.getByText('Cases per month').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Engineers' })).toBeVisible();
  await axe(page);
  await page.goto('/workspace/low-ratings');
  await expect(page.getByRole('heading', { name: 'Low ratings to call back' })).toBeVisible();
  await axe(page);
});
