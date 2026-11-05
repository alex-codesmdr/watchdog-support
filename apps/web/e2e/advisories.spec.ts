import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn, signOut } from './helpers';

/** Phase 4b: PSIRT publishes an advisory; the public, customers and subscribers see it. */
const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
};

test('anyone can read published advisories and the RSS feed @mobile', async ({ page, request }) => {
  await page.goto('/advisories');
  await expect(page.getByRole('heading', { level: 1, name: 'Security advisories' })).toBeVisible();
  await page.getByRole('link', { name: /Cross-site request forgery on CoreLink/ }).click();
  await expect(page.getByRole('heading', { name: 'Affected products and fixes' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '7.1.075' }).first()).toBeVisible();
  await axe(page);
  const rss = await request.get('/api/v1/advisories/rss.xml');
  expect(rss.ok()).toBe(true);
  expect(await rss.text()).toContain('<title>WatchDog security advisories</title>');
});

test('an L3 engineer drafts and publishes; a customer sees their exposure', async ({ page }) => {
  const title = `Denial of service via crafted LLDP frames ${Date.now()}`;
  await signIn(page, 'farah.l3@watchdog.example', '/admin/advisories/new');
  await page.waitForLoadState('networkidle'); // typing before hydration would be wiped
  await page.getByLabel(/^Title/).fill(title);
  await page
    .getByLabel(/^Summary/)
    .fill('A crafted LLDP frame can restart the LLDP process repeatedly.');
  await page.getByLabel(/^Severity/).selectOption('high');
  await page.getByLabel('CVSS score').fill('7.5');
  await page.getByLabel('Model').first().selectOption({ label: 'WatchDog CoreLink SW5600-48P' });
  await page.getByLabel('Affected versions').first().fill('7.1.060 to 7.1.070');
  await page.getByLabel('Fixed in').first().fill('7.1.075');
  await page.getByLabel(/PSIRT notes/).fill('Found in internal fuzzing.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText('Draft: visible only to staff.')).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Publish advisory' }).click();
  await expect(page.getByText(/Published, revision 1/)).toBeVisible();
  const wdId = (await page.locator('h1 .font-mono').textContent())!.trim();
  await page.goto('/workspace');
  await signOut(page);

  await signIn(page, 'noc@kaveribank.example');
  await page.goto(`/advisories/${wdId}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText(/of your installed devices (is an|are) affected/)).toBeVisible();
  await expect(page.getByText('Found in internal fuzzing.')).toHaveCount(0);
  await page.goto('/advisories');
  await page.waitForLoadState('networkidle'); // a click before hydration is reset
  await page.getByRole('checkbox', { name: 'Switching' }).check();
  await page.getByLabel('Minimum severity').selectOption('high');
  await page.getByRole('button', { name: /Turn on alerts|Save alerts/ }).click();
  await expect(page.getByText('Email alerts saved.')).toBeVisible();
  await axe(page);
  await page.goto('/portal');
  await signOut(page);
});
