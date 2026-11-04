import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** WCAG 2.1 AA automated checks on every public page (Lighthouse a11y runs in CI as well). */
const PUBLIC = [
  '/',
  '/register',
  '/search?q=bgp',
  '/search?type=troubleshooting',
  '/kb/collect-a-tech-support-bundle',
  '/kb/configure-ipsec-site-to-site-vpn',
  '/products/switching',
  '/downloads',
  '/advisories',
  '/warranty',
  '/privacy',
  '/csat?token=x',
];

for (const path of PUBLIC) {
  test(`axe: ${path} @mobile`, async ({ page }) => {
    await page.goto(path);
    const r = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}

test('axe: signed-in case form and case page', async ({ page }) => {
  await page.goto('/auth/login?returnTo=/portal/cases/new');
  await page.locator('button[value="noc@kaveribank.example"]').click();
  await page.waitForURL(/cases\/new/);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test('axe: SLA report (support manager)', async ({ page }) => {
  await page.goto('/auth/login?returnTo=/workspace/sla');
  await page.locator('button[value="rohan.manager@watchdog.example"]').click();
  await page.waitForURL(/workspace\/sla/);
  await expect(page.getByRole('heading', { name: 'SLA compliance' })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
