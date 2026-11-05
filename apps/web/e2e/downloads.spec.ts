import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn, signOut } from './helpers';

/** Phase 3e: download centre access levels, licence acceptance and checksums. */
const release = (page: import('@playwright/test').Page, title: string, version: string) =>
  page.locator('li', {
    has: page.getByRole('heading', { name: `${title} ${version}`, exact: true }),
  });

test('visitors download public files and are asked to sign in for firmware @mobile', async ({
  page,
}) => {
  await page.goto('/downloads');
  await expect(page.getByRole('heading', { level: 1, name: 'Downloads' })).toBeVisible();
  const fw = release(page, 'CoreLink OS', '7.1.075');
  await expect(fw.getByRole('link', { name: 'Sign in to download' })).toBeVisible();
  await expect(page.getByText('Field diagnostic collector')).toHaveCount(0);

  const mib = release(page, 'WatchDog enterprise MIBs', '2026.10');
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    mib.getByRole('button', { name: 'Download WATCHDOG-SMI.mib' }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe('WATCHDOG-SMI.mib');
});

test('a covered customer accepts the licence once and downloads firmware', async ({ page }) => {
  await signIn(page, 'noc@kaveribank.example');
  await page.goto('/downloads?family=switching');
  const fw = release(page, 'CoreLink OS', '7.1.075');
  await expect(fw.getByText('SHA-256')).toBeVisible();
  const button = fw.getByRole('button', { name: 'Download corelink-os-7.1.075.bin' });
  // Reruns against the same database find the licence already accepted.
  const firstTime = await fw.getByText(/Downloading asks you to accept/).isVisible();
  const download = page.waitForEvent('download');
  await button.click();
  if (firstTime) {
    const dialog = page.getByRole('dialog', { name: 'WatchDog Software Licence Agreement' });
    await expect(dialog.getByText(/Apollo Infoways Pvt. Ltd./)).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await dialog.getByRole('button', { name: 'Accept and download' }).click();
  }
  expect((await download).suggestedFilename()).toBe('corelink-os-7.1.075.bin');
  await page.reload();
  await expect(fw.getByText(/You accepted the WatchDog Software Licence Agreement/)).toBeVisible();
  await page.goto('/portal');
  await signOut(page);
});

test('a customer without switch coverage is pointed to a renewal quote', async ({ page }) => {
  await signIn(page, 'netops@narmadacity.example');
  await page.goto('/downloads?family=switching');
  const fw = release(page, 'CoreLink OS', '7.1.075');
  await expect(fw.getByRole('link', { name: 'Request a renewal quote' })).toBeVisible();
  await expect(fw.getByRole('button', { name: /Download/ })).toHaveCount(0);
  await page.goto('/portal');
  await signOut(page);
});

test('a content editor publishes a release with a checked file', async ({ page }) => {
  const version = `2.4.${Date.now() % 100000}`;
  await signIn(page, 'meera.content@watchdog.example', '/workspace');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' }).click();
  await page.getByRole('link', { name: 'Releases' }).click();
  await page.getByRole('link', { name: 'New release' }).click();
  await page.getByLabel(/Product family/).selectOption({ label: 'Wireless' });
  await page.getByLabel(/^Title/).fill('AirPack firmware');
  await page.getByLabel(/^Version/).fill(version);
  await page.getByLabel(/Who can download/).selectOption('registered');
  await page.getByLabel('WatchDog AirPack AP720 (Wi-Fi 6E)').check();
  await page.getByLabel(/Release notes/).fill('## Fixed\n- Roaming between 6 GHz radios');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: `AirPack firmware ${version}` }),
  ).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  await page.getByLabel('Add a file').setInputFiles({
    name: `airpack-${version}.bin`,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('AIRPACK'.repeat(4096)),
  });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText(/The virus check runs now/)).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText('Checked', { exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Status: Published')).toBeVisible();
  await page.goto('/workspace');
  await signOut(page);

  await signIn(page, 'noc@kaveribank.example');
  await page.goto(`/downloads?family=wireless&q=${version}`);
  await expect(
    release(page, 'AirPack firmware', version).getByRole('button', {
      name: `Download airpack-${version}.bin`,
    }),
  ).toBeVisible();
  await page.goto('/portal');
  await signOut(page);
});
