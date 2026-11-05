import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn, signOut } from './helpers';

/** Phase 4c: a customer admin creates an API key and a webhook. */
test('customer admin connects a system with an API key and a webhook', async ({
  page,
  request,
}) => {
  await signIn(page, 'it.admin@kaveribank.example');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Integrations' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'API keys and webhooks' }),
  ).toBeVisible();
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Create API key' }).click();
  const d = page.getByRole('dialog', { name: 'Create an API key' });
  await d.getByLabel(/^Name/).fill(`E2E monitor ${Date.now()}`);
  await d.getByLabel('Read devices and coverage').check();
  await d.getByRole('button', { name: 'Create key' }).click();
  const shown = page.getByRole('dialog', { name: 'Your new API key' });
  const key = (await shown.locator('code').textContent())!.trim();
  expect(key).toMatch(/^wdk_[a-z0-9]{10}_[A-Za-z0-9]{40}$/);
  const r = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']);
  expect((await r.analyze()).violations.map((v) => v.id)).toEqual([]);
  await shown.getByRole('button', { name: 'I have stored it' }).click();
  await expect(page.getByText(key)).toHaveCount(0);

  // The key works from outside the browser, through the same address.
  const res = await request.get('/api/v1/assets', { headers: { authorization: `WD-Key ${key}` } });
  expect(res.status()).toBe(200);
  expect((await res.json()).items.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Add webhook' }).click();
  const w = page.getByRole('dialog', { name: 'Add a webhook' });
  await w.getByLabel(/Address/).fill('http://localhost:8080/webhook-sink');
  await w.getByRole('button', { name: 'Add webhook' }).click();
  await expect(page.getByRole('dialog', { name: 'Signing secret' }).locator('code')).toContainText(
    'whsec_',
  );
  await page.getByRole('button', { name: 'I have stored it' }).click();
  const row = page.locator('li', { hasText: 'http://localhost:8080/webhook-sink' }).first();
  await row.getByRole('button', { name: 'Send test' }).click();
  await expect(row.getByText('Test delivered (HTTP 204).')).toBeVisible();
  await row.getByRole('button', { name: /Delete webhook/ }).click();
  await page.goto('/portal');
  await signOut(page);
});
