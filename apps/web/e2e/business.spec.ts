import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`),
  ).toEqual([]);
};

test('a customer administrator sees contracts, asks to renew, and sees end-of-sale advice', async ({
  page,
}) => {
  await signIn(page, 'it.admin@kaveribank.example', '/portal');
  await page.goto('/portal/contracts');
  await expect(
    page.getByRole('heading', { name: 'Branch SD-WAN warranty extension' }),
  ).toBeVisible();
  await expect(page.getByText('AIPL/', { exact: false }).first()).toBeVisible();
  await axe(page);
  const ask = page.getByRole('button', { name: 'Ask to renew KCB-WTY-EDGE' });
  if (await ask.isVisible()) {
    await ask.click();
    await page.getByLabel('Anything we should know').fill('Three years, please.');
    await page.getByRole('button', { name: 'Ask for a quote' }).click();
  }
  await expect(page.getByText(/Renewal requested/).first()).toBeVisible();

  await page.goto('/portal/assets');
  await page.getByText('End of sale announced', { exact: false }).first().click();
  await expect(page.getByText('Suggested replacement: WatchDog CoreLink SW5600-48P')).toBeVisible();

  await page.goto('/portal/team');
  await expect(page.getByRole('heading', { name: 'Partners who can act for you' })).toBeVisible();
});

test('customers post and vote on suggestions; staff reply', async ({ page, browser, baseURL }) => {
  const title = `Bulk export of device list ${Date.now().toString(36)}`;
  await signIn(page, 'noc@kaveribank.example', '/portal');
  await page.goto('/portal/ideas');
  await expect(async () => {
    await page.getByLabel('Your suggestion in one line').fill(title);
    await expect(page.getByLabel('Your suggestion in one line')).toHaveValue(title, {
      timeout: 1000,
    });
  }).toPass();
  await page
    .getByLabel('What would it help you do?')
    .fill('Our auditors want every serial number once a quarter.');
  await page.getByRole('button', { name: 'Post suggestion' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await axe(page);

  const ctx = await browser.newContext({ baseURL });
  const staff = await ctx.newPage();
  await signIn(staff, 'rohan.manager@watchdog.example', '/workspace');
  await staff.goto('/workspace/ideas');
  const item = staff
    .getByRole('listitem')
    .filter({ has: staff.getByRole('heading', { name: title }) });
  await item.getByLabel('Status').selectOption('planned');
  await item.getByLabel('Reply shown to customers').fill('Planned for the next portal update.');
  await item.getByRole('button', { name: 'Save' }).click();
  await expect(staff.getByText(`Saved "${title}".`)).toBeVisible();
  await ctx.close();

  await page.reload();
  await expect(
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: title }) })
      .getByText('Planned for the next portal update.'),
  ).toBeVisible();
});

test('a support manager works renewals, the roster, partners and product lifecycle', async ({
  page,
}) => {
  await signIn(page, 'rohan.manager@watchdog.example', '/workspace');
  for (const [path, heading] of [
    ['/workspace/renewals', 'Renewal pipeline'],
    ['/admin/contracts', 'Contracts and invoices'],
    ['/admin/partners', 'Partner access'],
    ['/workspace/roster', 'Roster and on call'],
    ['/admin/lifecycle', 'Product lifecycle'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await axe(page);
  }
  await page.goto('/workspace/renewals?days=365');
  await expect(page.getByText('Branch SD-WAN warranty extension', { exact: false })).toBeVisible();
});
