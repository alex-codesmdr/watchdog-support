import { expect, test } from '@playwright/test';
import { signIn, signOut } from './helpers';

test('anyone can search, read and rate a public article @mobile', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Search knowledge base, products, errors').fill('ipsec no proposal chosen');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('heading', { name: /results for/ })).toBeVisible();
  await page.getByRole('link', { name: 'IPsec SA negotiation failed: no proposal chosen' }).click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'IPsec SA negotiation failed: no proposal chosen',
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Yes' }).click();
  await expect(
    page.getByText('Thanks. Your feedback helps us improve this article.'),
  ).toBeVisible();
});

test('registered-only articles are hidden from visitors and shown to customers', async ({
  page,
}) => {
  await page.goto('/kb/core-switch-reboots-watchdog-timeout');
  await expect(page.getByRole('heading', { name: 'We could not find that page' })).toBeVisible();
  await signIn(page, 'noc@kaveribank.example');
  await page.goto('/kb/core-switch-reboots-watchdog-timeout');
  await expect(page.getByRole('heading', { level: 1, name: /SW5600 reboots/ })).toBeVisible();
  await expect(page.getByText('Visible to: Registered customers')).toBeVisible();
});

test('case form suggests articles while the customer types', async ({ page }) => {
  await signIn(page, 'noc@kaveribank.example', '/portal/cases/new');
  await page.getByLabel(/Serial number/).fill('WDFW3100B0002');
  await expect(page.getByText(/Covered by Premium/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/^Subject/).fill('PoE budget exceeded on access switch');
  await expect(page.getByText('These articles may solve it right away')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'PoE budget exceeded: ports stop powering devices' }),
  ).toBeVisible();
});

test('content editor writes and publishes an article', async ({ page }) => {
  const title = `Configure NTP on CoreLink switches ${Date.now()}`;
  await signIn(page, 'meera.content@watchdog.example', '/workspace/kb');
  await page.getByRole('link', { name: 'New article' }).click();
  await page.getByLabel('Title').fill(title);
  await page
    .getByLabel(/Summary/)
    .fill('Point every switch at two NTP servers so log timestamps line up.');
  await page
    .getByLabel('Article')
    .fill('## Steps\n\n```\nntp-service unicast-server 10.0.0.1\n```');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText('Draft created.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish version 1' }).click();
  await expect(page.getByText('Published. Readers now see this version.')).toBeVisible();
  await signOut(page);
  await page.goto(`/search?q=${encodeURIComponent('NTP CoreLink')}`);
  await expect(page.getByRole('link', { name: title })).toBeVisible();
});
