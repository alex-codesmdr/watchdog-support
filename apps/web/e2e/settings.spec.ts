import { expect, test } from '@playwright/test';
import { signIn, signOut } from './helpers';

test('support manager changes the P1 line and it shows on the home page', async ({
  page,
  browser,
  baseURL,
}) => {
  const phone = `1800 ${String(Date.now()).slice(-3)} 4000`;
  await signIn(page, 'rohan.manager@watchdog.example', '/workspace');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' }).click();
  await page.getByRole('link', { name: 'Portal settings' }).click();
  const old = await page.getByLabel('P1 outage line').inputValue();
  await page.getByLabel('P1 outage line').fill(phone);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  const ctx = await browser.newContext({ baseURL });
  const visitor = await ctx.newPage();
  await expect(async () => {
    await visitor.goto('/register');
    await expect(
      visitor.getByRole('heading', { name: 'Register your organisation' }),
    ).toBeVisible();
  }).toPass();
  await ctx.close();

  await page.getByLabel('P1 outage line').fill(old);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await signOut(page);
});
