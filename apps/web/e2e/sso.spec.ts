/**
 * Sign in with a Microsoft or Google account, through the real Keycloak realm. Runs only when an
 * extra test identity provider "corp-test" is configured with the realm's linking flows
 * (SSO_E2E=1, see docs/runbooks/development.md). A stand-in OIDC server plays Microsoft.
 */
import { expect, test, type Page } from '@playwright/test';
import { totp } from './helpers';

test.skip(!process.env.SSO_E2E, 'needs Keycloak with the corp-test identity provider');
test.describe.configure({ mode: 'serial' });

async function viaCorp(page: Page, email: string) {
  await page.goto('/auth/login?returnTo=%2Fportal');
  await page.getByRole('link', { name: 'Corp test' }).click();
  await page.locator(`button[value="${email}"]`).click();
}
async function code(page: Page) {
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500); // a fresh code window
  await page.locator('#otp').fill(totp());
  await page.locator('#kc-login').click();
}

test('first time: confirm with the WatchDog password, then the authenticator code', async ({
  page,
}) => {
  await viaCorp(page, 'noc@kaveribank.example');
  await page.locator('#linkAccount').click();
  await page.locator('#password').fill('Demo@WatchDog2026');
  await page.locator('#kc-login').click();
  await code(page);
  await expect(page).toHaveURL(/\/portal/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('after that: straight to the authenticator code', async ({ page }) => {
  await viaCorp(page, 'noc@kaveribank.example');
  await expect(page.locator('#password')).toHaveCount(0);
  await code(page);
  await expect(page).toHaveURL(/\/portal/);
});

test('someone without a WatchDog account cannot get in', async ({ page }) => {
  await viaCorp(page, 'netops@narmadacity.example');
  await expect(page.getByText(/does not exist|doesn't exist/i)).toBeVisible();
  await expect(page).not.toHaveURL(/localhost:3000\/portal/);
});
