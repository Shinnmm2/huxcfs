const { test, expect } = require('@playwright/test');

test('filters, searches, and selects a server', async ({ page }) => {
  await page.goto('/play');
  await expect(page.locator('.server-card')).toHaveCount(6);
  await page.getByRole('tab', { name: 'Official' }).click();
  await expect(page.locator('.server-card')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Search servers or maps' }).fill('Español');
  await expect(page.locator('.server-card')).toHaveCount(1);
  await page.locator('[data-select="espanol"]').click();
  await expect(page.locator('#joinContent')).toContainText('Servidor Español');
  await page.getByRole('button', { name: 'Join server', exact: false }).last().click();
  await expect(page.getByRole('dialog')).toContainText('This is a demo');
});

test('saves a guest profile across reloads', async ({ page }) => {
  await page.goto('/play');
  await page.locator('.profile-panel').getByRole('button', { name: /Edit/ }).click();
  await page.getByLabel('Display name').fill('Alex');
  await page.getByLabel(/Username/).fill('alex');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.reload();
  await expect(page.locator('#profileName')).toContainText('Alex');
  await expect(page.locator('#profileHandle')).toHaveText('@alex');
});

test('creates and deletes a locally saved server, and cancel discards changes', async ({ page }) => {
  await page.goto('/play');
  await page.getByRole('button', { name: 'Create a server', exact: false }).click();
  await page.getByLabel('Server name').fill('Discarded');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Discarded')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create a server', exact: false }).click();
  await page.getByLabel('Server name').fill('Test Lounge');
  await page.getByRole('dialog').getByLabel('Map').selectOption('slap');
  await page.getByRole('dialog').getByRole('button', { name: 'Create server' }).click();
  await expect(page.locator('#joinContent')).toContainText('Test Lounge');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Test Lounge' })).toBeVisible();
  await page.getByRole('button', { name: /My servers/ }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toContainText('No servers yet');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Test Lounge' })).toHaveCount(0);
});

test('serves app assets without exposing repository files', async ({ request }) => {
  expect((await request.get('/play')).status()).toBe(200);
  expect((await request.get('/app.js')).status()).toBe(200);
  expect((await request.get('/.git/config')).status()).toBe(404);
});

test('fits a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/play');
  await expect(page.getByRole('heading', { name: 'Find your place to play.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
