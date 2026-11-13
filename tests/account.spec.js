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

test('a rejected saved session can be replaced without deleting its backup', async ({ page }) => {
  const oldToken = 'A'.repeat(43);
  await page.addInitScript(token => { if (!sessionStorage.getItem('test-session-seeded')) { localStorage.setItem('condo-guest-token:' + location.origin, token); sessionStorage.setItem('test-session-seeded', 'yes'); } }, oldToken);
  await page.route('**/api/config', route => route.fulfill({ json: { service: 'condo-api', verification: { enabled: true, siteKey: 'test-key', testMode: false } } }));
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', route => route.fulfill({ contentType: 'text/javascript', body: "window.turnstile={render(el,opts){el.textContent='Test CAPTCHA';opts.callback('valid');return 'widget';},remove(){},reset(){}};" }));
  await page.goto('/login');
  await expect(page.locator('#accountMode')).toContainText('SESSION EXPIRED');
  await expect(page.locator('#sessionNotice')).toBeVisible();
  await expect(page.locator('#sessionNotice')).toContainText('previous guest data may not appear');
  await expect(page.locator('#verifyStepOne')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('condo-guest-token:' + location.origin))).toBe(oldToken);
  await page.getByRole('button', { name: 'Start a new session' }).click();
  await expect(page.locator('#accountMode')).toContainText('CONNECTED');
  await expect(page.getByText('Test CAPTCHA', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('condo-guest-token:' + location.origin))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('condo-guest-token:' + location.origin + ':saved-sessions')))).toContain(oldToken);
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await page.getByLabel('Display name').fill('Fresh guest');
  await page.getByRole('button', { name: /Save and continue/ }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Fresh guest.' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('condo-guest-token:' + location.origin))).not.toBe(oldToken);
});

test('temporary profile errors keep the saved session and report backend failure', async ({ page }) => {
  const oldToken = 'B'.repeat(43);
  await page.addInitScript(token => localStorage.setItem('condo-guest-token:' + location.origin, token), oldToken);
  await page.route('**/api/config', route => route.fulfill({ json: { service: 'condo-api', verification: { enabled: true, siteKey: 'test-key' } } }));
  await page.route('**/api/profile', route => route.fulfill({ status: 503, json: { error: 'Database unavailable' } }));
  await page.goto('/login');
  await expect(page.locator('#accountMode')).toContainText('OFFLINE');
  await expect(page.locator('#captchaOne')).toHaveText('The backend is unavailable. Please try again later.');
  await expect(page.locator('#sessionNotice')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('condo-guest-token:' + location.origin))).toBe(oldToken);
});

test('a failed backup does not delete the rejected session', async ({ page }) => {
  const oldToken = 'C'.repeat(43);
  await page.addInitScript(token => {
    const key = 'condo-guest-token:' + location.origin;
    localStorage.setItem(key, token);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name.endsWith(':saved-sessions')) throw new Error('Storage unavailable');
      return original.call(this, name, value);
    };
  }, oldToken);
  await page.goto('/login');
  await expect(page.locator('#sessionNotice')).toBeVisible();
  await page.getByRole('button', { name: 'Start a new session' }).click();
  await expect(page.locator('#sessionError')).toContainText('Could not save your previous session');
  expect(await page.evaluate(() => localStorage.getItem('condo-guest-token:' + location.origin))).toBe(oldToken);
});
