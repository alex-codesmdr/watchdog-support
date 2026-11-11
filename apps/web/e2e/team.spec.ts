import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn, signOut } from './helpers';

/** Team management for customer administrators, and My account for everyone. */
const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
};

test('customer administrator invites a colleague and switches their access off', async ({
  page,
}) => {
  const email = `e2e.${Date.now().toString(36)}@kaveribank.example`;
  await signIn(page, 'it.admin@kaveribank.example');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Administration' })
    .click();
  await page.getByRole('link', { name: 'Your team' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your team' })).toBeVisible();
  await page.getByLabel('Name').fill('Meera Joshi');
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invited Meera Joshi.', { exact: false })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Switch off access for Meera Joshi' }).first().click();
  await expect(page.getByText('Meera Joshi can no longer sign in.')).toBeVisible();
  await signOut(page);
});

test('anyone can set their email language in My account', async ({ page }) => {
  await signIn(page, 'netops@narmadacity.example');
  await page.getByRole('link', { name: 'My account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My account' })).toBeVisible();
  await axe(page);
  await page.getByLabel('Language', { exact: true }).selectOption('hi-IN');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('hi-IN');
  await page.getByLabel('Language', { exact: true }).selectOption('en-IN');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await signOut(page);
});
