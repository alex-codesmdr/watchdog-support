import { expect, type Page } from '@playwright/test';

/** Signs in through the OIDC flow (mock IdP locally; Keycloak test users in CI). */
export async function signIn(page: Page, email: string, returnTo = '/portal') {
  await page.goto(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  if (process.env.KEYCLOAK_E2E) {
    await page.getByLabel(/username|email/i).fill(email);
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? '');
    await page.getByRole('button', { name: /sign in/i }).click();
  } else {
    await page.locator(`button[value="${email}"]`).click();
  }
  await expect(page).toHaveURL(new RegExp(returnTo.replace(/\//g, '\\/')));
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
}
