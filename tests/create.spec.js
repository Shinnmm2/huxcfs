const { test, expect } = require('@playwright/test');

test('create page makes a public listing linked to a Roblox game', async ({ browser }) => {
  const first = await browser.newContext(), second = await browser.newContext();
  try {
    const page = await first.newPage(), visitor = await second.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/create');
    await expect(page.locator('#createMode')).toContainText('CONNECTED');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel('Server name').fill('Map hangout');
    await page.getByLabel('Slap Royale').check();
    await page.getByLabel(/Roblox game URL/).fill('https://www.roblox.com/games/123456/My-Game');
    await page.getByLabel('Visibility').selectOption('public');
    await page.getByLabel('Maximum players shown').selectOption('20');
    await page.getByRole('button', { name: /Create listing/ }).click();
    await expect(page.locator('#joinContent')).toContainText('Map hangout');
    await visitor.goto('/play');
    await expect(visitor.getByRole('heading', { name: 'Map hangout' })).toBeVisible();
    await visitor.getByRole('heading', { name: 'Map hangout' }).locator('..').locator('..').getByRole('button', { name: /Join server/ }).click();
    await expect(visitor.getByRole('link', { name: 'Open Roblox game' })).toHaveAttribute('href', 'https://www.roblox.com/games/123456');
    await page.goto('/create');
    await expect(page.locator('#listingCount')).toHaveText('1 / 10');
  } finally { await first.close(); await second.close(); }
});

test('create page reports rejected sessions and invalid game links', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('condo-guest-token:' + location.origin, 'A'.repeat(43)));
  await page.goto('/create');
  await expect(page.locator('#createMode')).toContainText('SESSION EXPIRED');
  await expect(page.getByRole('alert')).toContainText('saved session was rejected');
  await expect(page.getByRole('button', { name: /Create listing/ })).toBeDisabled();
});

test('create page rejects invalid game links without creating a listing', async ({ page }) => {
  await page.goto('/create');
  await expect(page.locator('#createMode')).toContainText('CONNECTED');
  await page.getByLabel('Server name').fill('Bad link');
  await page.getByLabel(/Roblox game URL/).fill('https://example.com/games/123456');
  await page.getByRole('button', { name: /Create listing/ }).click();
  await expect(page.getByRole('alert')).toContainText('public Roblox game URL');
  expect(await page.evaluate(() => localStorage.getItem('condo-guest-token:' + location.origin))).toBeNull();
});
