const { test, expect } = require('@playwright/test');

test('guest profile is shared across home, login, and servers', async ({ page, request }) => {
  expect((await request.get('/home')).status()).toBe(200);
  expect((await request.get('/login')).status()).toBe(200);
  await page.goto('/home');
  await expect(page.locator('#accountMode')).toContainText('CONNECTED');
  await page.getByRole('link', { name: 'Edit your profile' }).click();
  await expect(page.getByRole('heading', { name: 'Continue as a guest' })).toBeVisible();
  await page.getByLabel('Display name').fill('Morgan');
  await page.locator('#guestUsername').fill('morgan');
  await page.getByRole('button', { name: /Save and continue/ }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Morgan.' })).toBeVisible();
  await expect(page.locator('#homeSubtitle')).toContainText('@morgan');
  await page.getByRole('link', { name: 'Explore servers' }).click();
  await expect(page.locator('#profileName')).toContainText('Morgan');
  await expect(page.locator('#profileHandle')).toHaveText('@morgan');
  await page.reload();
  await expect(page.locator('#profileName')).toContainText('Morgan');
});

test('home rejects invalid IDs and reports missing servers', async ({ page }) => {
  await page.goto('/home');
  await page.getByLabel('Server ID').fill('not valid!');
  await page.getByRole('button', { name: /Find/ }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a valid server ID');
  await page.getByLabel('Server ID').fill('does-not-exist');
  await page.getByRole('button', { name: /Find/ }).click();
  await expect(page.locator('#toast')).toHaveText('Server not found');
});

test('login reports backend failures without saving a guest profile', async ({ page }) => {
  await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: "window.CONDO_API_BASE_URL = 'https://unavailable.invalid';" }));
  await page.route('https://unavailable.invalid/**', route => route.abort());
  await page.goto('/login?guest=1');
  await expect(page.locator('#accountMode')).toContainText('OFFLINE');
  await expect(page.getByRole('button', { name: /Save and continue/ })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('backend is unavailable');
});

test('guest profile works through a configured cross-origin backend', async ({ page }) => {
  await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: "window.CONDO_API_BASE_URL = 'http://127.0.0.1:4173';" }));
  await page.goto('http://localhost:4173/login?guest=1');
  await expect(page.locator('#accountMode')).toContainText('CONNECTED');
  await page.getByLabel('Display name').fill('Sky');
  await page.getByRole('button', { name: /Save and continue/ }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Sky.' })).toBeVisible();
  await page.getByRole('link', { name: 'Explore servers' }).click();
  await expect(page.locator('#profileName')).toContainText('Sky');
});
