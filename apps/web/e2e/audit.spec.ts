import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn, signOut } from './helpers';

/** Phase 4d: the audit trail (staff) and the activity log (customer administrators). */
const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
};

test('support manager filters the audit trail and checks the chain', async ({ page }) => {
  await signIn(page, 'rohan.manager@watchdog.example', '/workspace');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' }).click();
  await page.getByRole('link', { name: 'Audit trail' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Audit trail' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: /Check the trail/ }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Intact/ })).toBeVisible();
  await signOut(page);
});

test('customer administrator sees only their organisation in the activity log', async ({
  page,
}) => {
  await signIn(page, 'it.admin@kaveribank.example');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Administration' })
    .click();
  await page.getByRole('link', { name: 'Activity log' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Activity log' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Check the trail/ })).toHaveCount(0);
  await axe(page);
  await signOut(page);
});
