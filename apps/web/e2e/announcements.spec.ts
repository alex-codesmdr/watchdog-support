import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiAs, signIn, signOut } from './helpers';

/** Phase 4d: announcement banners and engineers' saved replies. */
const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
};

test('support manager posts a banner that visitors see, can dismiss, and is taken down', async ({
  page,
  browser,
  baseURL,
}) => {
  const title = `Planned upgrade of the portal ${Date.now().toString(36)}`;
  await signIn(page, 'rohan.manager@watchdog.example', '/workspace');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' }).click();
  await page.getByRole('link', { name: 'Announcements' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Announcements' })).toBeVisible();
  await page.getByLabel('Headline').fill(title);
  await page.getByLabel('More detail').fill('The portal may be slow for a few minutes.');
  await page.getByLabel('Kind').selectOption('maintenance');
  await page.getByRole('button', { name: 'Publish announcement' }).click();
  await expect(page.getByText('Saved. The banner is showing now.')).toBeVisible();
  await axe(page);

  const vc = await browser.newContext({ baseURL });
  const visitor = await vc.newPage();
  await visitor.goto('/');
  const banners = visitor.getByRole('region', { name: 'Announcements' });
  await expect(banners.getByText(title)).toBeVisible();
  await axe(visitor);
  await banners.getByRole('button', { name: `Dismiss: ${title}` }).click();
  await expect(visitor.getByText(title)).toHaveCount(0);
  await visitor.reload();
  await expect(visitor.getByText(title)).toHaveCount(0);
  await vc.close();

  await page.getByRole('button', { name: `Take down: ${title}` }).click();
  await expect(page.getByText(`Taken down: ${title}`)).toBeVisible();
  const fc = await browser.newContext({ baseURL });
  const fresh = await fc.newPage();
  await fresh.goto('/');
  await expect(fresh.getByText(title)).toHaveCount(0);
  await fc.close();
  await signOut(page);
});

test('engineer inserts a shared saved reply with the case details filled in', async ({ page }) => {
  // A fresh case of our own, so the test does not depend on other tests' data.
  await signIn(page, 'it.admin@kaveribank.example');
  const c = await apiAs<{ number: string }>(page, 'POST', '/v1/cases', {
    serialNumber: 'WDFW3100B0002',
    severity: 'P3',
    category: 'config',
    subject: 'VPN tunnel flaps after the ISP change',
    description:
      'The site-to-site tunnel to the branch goes down every night and needs a manual reset.',
  });
  await signOut(page);
  await signIn(page, 'vikram.l2@watchdog.example', '/workspace');
  await page.goto(`/workspace/cases/${c.number}`);
  await page
    .getByRole('combobox', { name: /Insert a saved reply/ })
    .selectOption({ label: 'Ask for diagnostic logs' });
  const box = page.getByLabel('Reply to customer', { exact: true });
  await expect(box).toHaveValue(/^Hello .+,/);
  await expect(box).not.toHaveValue(/\{\{/);
  await expect(box).toHaveValue(/Vikram/);
  await axe(page);
  await page.getByRole('link', { name: 'Manage saved replies' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Saved replies' })).toBeVisible();
  await page.getByLabel('Name').fill('My quick check');
  await page.getByLabel('Reply text').fill('Hi {{customer_name}}, checking in on {{case_ref}}.');
  await expect(page.getByLabel('Share with every engineer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save reply' }).click();
  await expect(page.getByText('Saved: My quick check')).toBeVisible();
  await page.getByRole('button', { name: 'Delete: My quick check' }).click();
  await expect(page.getByText('Deleted: My quick check')).toBeVisible();
  await axe(page);
  await signOut(page);
});
