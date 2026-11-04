import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

/** RFC 6238 TOTP for the demo realm's pre-enrolled authenticator (local/CI only). */
function totp(raw = 'WatchDogDemoTotpKey2026', step = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / step)));
  const h = createHmac('sha1', raw).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Signs in through the OIDC flow (mock IdP locally; Keycloak test users in CI). */
export async function signIn(page: Page, email: string, returnTo = '/portal') {
  await page.goto(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  if (process.env.KEYCLOAK_E2E) {
    await page.getByLabel(/username|email/i).fill(email);
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? 'Demo@WatchDog2026');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByLabel(/one-time code/i).fill(totp());
    await page.getByRole('button', { name: /sign in|submit/i }).click();
  } else {
    await page.locator(`button[value="${email}"]`).click();
  }
  await expect(page).toHaveURL(new RegExp(returnTo.replace(/\//g, '\\/')));
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
}
