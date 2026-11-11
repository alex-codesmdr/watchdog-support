import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiAs, signIn } from './helpers';

const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
};

test('a customer books a remote session from a case and can add it to a calendar', async ({
  page,
}) => {
  await signIn(page, 'noc@kaveribank.example', '/portal');
  const c = await apiAs<{ number: string }>(page, 'POST', '/v1/cases', {
    serialNumber: 'WDFW3100B0002',
    severity: 'P3',
    category: 'config',
    subject: 'Help moving firewall rules to the new zone',
    description: 'We would like an engineer to walk us through the zone change.',
  });
  await page.goto(`/portal/cases/${c.number}`);
  await page.getByRole('button', { name: 'Book a visit or session' }).click();
  await page.getByLabel('A remote session (1 hour)').check();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name="slot"]').first().check({ force: true });
  await dialog.getByLabel('Their phone').fill('+91 98450 12345');
  await axe(page);
  await dialog.getByRole('button', { name: 'Book this time' }).click();
  await expect(page.getByText(/Remote session booked for/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add to calendar' })).toBeVisible();
});

test('community: ask, answer as an engineer, mark the answer', async ({
  page,
  browser,
  baseURL,
}) => {
  const title = `Which optics for 10G uplinks between buildings ${Date.now().toString(36)}?`;
  await signIn(page, 'netops@narmadacity.example', '/portal');
  await page.goto('/community');
  await expect(async () => {
    await page.getByLabel('Your question').fill(title);
    await expect(page.getByLabel('Your question')).toHaveValue(title, { timeout: 1000 });
  }).toPass();
  await page
    .getByLabel('Details')
    .fill('Two buildings about 300 metres apart, multimode fibre already laid.');
  await page.getByRole('button', { name: 'Post question' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await axe(page);
  const url = page.url();

  const ctx = await browser.newContext({ baseURL });
  const eng = await ctx.newPage();
  await signIn(eng, 'vikram.l2@watchdog.example', '/workspace');
  await eng.goto(url);
  await expect(async () => {
    await eng
      .getByLabel('Your answer')
      .fill('Use 10GBASE-SR optics: multimode reaches 300 m on OM3.');
    await expect(eng.getByLabel('Your answer')).not.toHaveValue('', { timeout: 1000 });
  }).toPass();
  await eng.getByRole('button', { name: 'Post answer' }).click();
  await expect(eng.getByText('Vikram R., WatchDog engineer', { exact: false })).toBeVisible();
  await ctx.close();

  await page.reload();
  await page.getByRole('button', { name: 'Mark as the answer' }).click();
  await expect(page.getByText('Marked as the answer')).toBeVisible();
});

test('staff see visits and spare stock', async ({ page }) => {
  await signIn(page, 'arjun.rma@watchdog.example', '/workspace');
  await page.goto('/workspace/stock');
  await expect(page.getByRole('heading', { level: 1, name: 'Spare stock' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Noida (main depot)' })).toBeVisible();
  await axe(page);
});

test('engineers see booked visits', async ({ page }) => {
  await signIn(page, 'vikram.l2@watchdog.example', '/workspace');
  await page.goto('/workspace/visits');
  await expect(page.getByRole('heading', { level: 1, name: 'Visits' })).toBeVisible();
  await axe(page);
});
