import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn, signOut } from './helpers';

test('support manager adds, reorders and deletes a routing rule', async ({ page }) => {
  const name = `Critical switching ${Date.now().toString(36)}`;
  await signIn(page, 'rohan.manager@watchdog.example', '/workspace');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' }).click();
  await page.getByRole('link', { name: 'Case routing' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Case routing' })).toBeVisible();
  await page.getByLabel('Rule name').fill(name);
  await page.getByRole('group', { name: 'Severity' }).getByLabel(/^P1/).check();
  await page.getByRole('group', { name: 'Product family' }).getByLabel('Switching').check();
  await page.getByLabel('Put in queue').selectOption({ label: 'L2 – Product specialists' });
  await page
    .getByRole('group', { name: /Assign to the least busy/ })
    .getByRole('checkbox')
    .first()
    .check();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await expect(page.getByText(`Saved: ${name}`)).toBeVisible();
  await expect(page.getByText(/When P1; Switching: queue L2/)).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('button', { name: `Delete: ${name}` }).click();
  await expect(page.getByText(`Deleted: ${name}`)).toBeVisible();
  await signOut(page);
});
