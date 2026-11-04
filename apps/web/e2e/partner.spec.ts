import { expect, test } from '@playwright/test';
import { signIn, signOut } from './helpers';

/** Partners open cases on behalf of the customers that delegated access to them. */
test('a partner chooses the customer, then the device, and opens a case', async ({ page }) => {
  await signIn(page, 'support@sahyadri-si.example');
  await page.goto('/portal/cases/new');
  await expect(page.getByLabel(/^Customer/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Choose the customer this case is for.')).toBeVisible();
  await page.getByLabel(/^Customer/).selectOption({ label: 'Narmada Smart City Authority (Demo)' });
  // Devices of a customer that did not delegate access are not found.
  await page.getByLabel(/Serial number/).fill('WDSW5600A0001');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter the serial number of a registered device.')).toBeVisible();
  await page.getByLabel(/Serial number/).fill('WDRT8800E0005');
  await expect(page.getByText(/Covered by Premium/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/P3/).check();
  await page.getByLabel(/Category/).selectOption('config');
  await page.getByLabel(/^Subject/).fill('Partner-raised: OSPF area mismatch on new site');
  await page.getByLabel(/What is happening/).fill('Adjacency stuck in EXSTART after cut-over.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Open case' }).click();
  await expect(
    page.getByRole('heading', { name: 'Partner-raised: OSPF area mismatch on new site' }),
  ).toBeVisible();
  await signOut(page);
});
