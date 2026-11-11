import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiAs, signIn, signOut } from './helpers';

/** Engineer workspace: bulk assignment, saved views, customer panel, time logging. */
const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
};

test('engineer saves a view, bulk-assigns a case to themselves, and logs time on it', async ({
  page,
}) => {
  const tag = Date.now().toString(36);
  await signIn(page, 'it.admin@kaveribank.example');
  await apiAs(page, 'POST', '/v1/cases', {
    serialNumber: 'WDFW3100B0002',
    severity: 'P3',
    category: 'performance',
    subject: `Slow web filtering ${tag}`,
    description: 'Pages through the web filter take several seconds to open since Monday.',
  });
  await signOut(page);
  await signIn(page, 'vikram.l2@watchdog.example', '/workspace');
  await page.goto(`/workspace?view=all&severity=P3&q=${tag}`);
  await page.waitForLoadState('networkidle');
  const name = `P3s ${Date.now().toString(36)}`;
  await page.getByRole('button', { name: 'Save these filters as a view' }).click();
  await page.getByLabel('Name for this view').fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
  await axe(page);

  const first = page.locator('input[name="case"]').first();
  const number = await first.getAttribute('value');
  await first.check();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Assign selected' }).click();
  await expect(page.getByText(/Assigned 1 case to Vikram/)).toBeVisible();

  await page.goto(`/workspace/cases/${number}`);
  await expect(page.getByRole('heading', { name: 'Customer' })).toBeVisible();
  await expect(page.getByText('Open cases')).toBeVisible();
  await page.getByLabel('Minutes worked').fill('25');
  await page.getByLabel('What you did').fill('Checked interface counters');
  await page.getByRole('button', { name: 'Log time' }).click();
  await expect(page.getByText(/in total\. Only staff/)).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: /^Delete 25 min/ }).click();

  await page.goto('/workspace');
  // Retry until the page has hydrated and the delete has taken effect.
  await expect(async () => {
    const del = page.getByRole('button', { name: `Delete saved view ${name}` });
    if (await del.count()) await del.click();
    await expect(page.getByRole('link', { name })).toHaveCount(0, { timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await signOut(page);
});
