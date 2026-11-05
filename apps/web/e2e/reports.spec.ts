import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn, signOut } from './helpers';

/** Phase 4d: support report for customer admins (own organisation) and managers (all). */
const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
};

test('customer admin reads the report for their organisation and downloads the CSV', async ({
  page,
}) => {
  await signIn(page, 'it.admin@kaveribank.example');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Reports' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Support report' })).toBeVisible();
  await expect(page.getByText(/Kaveri Cooperative Bank/).first()).toBeVisible();
  await expect(page.getByLabel('Customer')).toHaveCount(0);
  await expect(page.getByText('Cases per week')).toBeVisible();
  await axe(page);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download cases (CSV)' }).click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/^watchdog-cases-.*\.csv$/);
  await page.goto('/portal');
  await signOut(page);
});

test('a manager filters the report by customer', async ({ page }) => {
  await signIn(page, 'rohan.manager@watchdog.example', '/workspace/reports');
  await expect(page.getByText('All customers,')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Busiest customers' })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Customer' })
    .selectOption({ label: 'Narmada Smart City Authority (Demo)' });
  await page.getByRole('button', { name: 'Update report' }).click();
  await expect(
    page.getByText(/^Narmada Smart City Authority \(Demo\), cases opened/),
  ).toBeVisible();
  await axe(page);
  await page.goto('/workspace');
  await signOut(page);
});
