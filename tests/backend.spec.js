const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function startPersistentServer(dbPath) {
  const process = spawn(processExec(), ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...global.process.env, PORT: '0', DATABASE_PATH: dbPath } });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => { process.kill(); reject(new Error('Server did not start')); }, 10000);
    process.stdout.on('data', chunk => { output += chunk; const match = /Server listening on (\d+)/.exec(output); if (match) { clearTimeout(timeout); resolve(Number(match[1])); } });
    process.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
  });
  return { process, base: `http://127.0.0.1:${port}` };
}
function processExec() { return global.process.execPath; }
async function stop(process) { await new Promise(resolve => { process.once('exit', resolve); process.kill('SIGTERM'); }); }

test('API validates input, protects ownership, and restricts origins', async ({ request }) => {
  expect((await request.get('/api/config')).status()).toBe(200);
  expect((await request.get('/api/servers', { headers: { Origin: 'https://attacker.example' } })).status()).toBe(403);
  const allowed = await request.get('/api/servers', { headers: { Origin: 'https://shinnmm2.github.io' } });
  expect(allowed.headers()['access-control-allow-origin']).toBe('https://shinnmm2.github.io');
  expect((await request.post('/api/servers', { data: { name: 'No owner', image: 'cc', max: 40 } })).status()).toBe(401);
  const a = await (await request.post('/api/guests')).json();
  const b = await (await request.post('/api/guests')).json();
  const authA = { Authorization: `Bearer ${a.token}` }, authB = { Authorization: `Bearer ${b.token}` };
  expect((await request.put('/api/profile', { headers: authA, data: { name: 'A' } })).status()).toBe(400);
  expect((await request.post('/api/servers', { headers: authA, data: { name: 'Invalid', image: 'cc', max: 999, visibility: 'public' } })).status()).toBe(400);
  const created = await request.post('/api/servers', { headers: authA, data: { name: 'Owned server', image: 'cc', max: 40, visibility: 'private' } });
  expect(created.status()).toBe(201);
  const { server } = await created.json();
  expect((await (await request.get('/api/servers')).json()).servers.some(item => item.id === server.id)).toBe(false);
  expect((await (await request.get(`/api/servers/${server.id}`)).json()).server.name).toBe('Owned server');
  expect((await request.delete(`/api/servers/${server.id}`, { headers: authB })).status()).toBe(404);
  await expect((await request.get('/api/servers/mine', { headers: authB })).json()).resolves.toEqual({ servers: [] });
  expect((await request.delete(`/api/servers/${server.id}`, { headers: authA })).status()).toBe(200);
});

test('servers are shared across browsers and owner can delete them', async ({ browser }) => {
  const first = await browser.newContext(), second = await browser.newContext();
  try {
    const a = await first.newPage(), b = await second.newPage();
    await a.goto('/play');
    await expect(a.locator('#modeLabel')).toContainText('CONNECTED');
    await a.locator('.profile-panel').getByRole('button', { name: /Edit/ }).click();
    await a.getByLabel('Display name').fill('Alex');
    await a.getByRole('button', { name: 'Save profile' }).click();
    await expect(a.locator('#profileName')).toContainText('Alex');
    await a.reload();
    await expect(a.locator('#profileName')).toContainText('Alex');
    await a.getByRole('button', { name: 'Create a server', exact: false }).click();
    await a.getByLabel('Server name').fill('Shared Lounge');
    await a.getByLabel('Visibility').selectOption('public');
    await a.getByRole('dialog').getByRole('button', { name: 'Create server' }).click();
    await expect(a.locator('#joinContent')).toContainText('Shared Lounge');
    await b.goto('/play');
    await expect(b.getByRole('heading', { name: 'Shared Lounge' })).toBeVisible();
    await b.getByRole('heading', { name: 'Shared Lounge' }).locator('..').locator('..').getByRole('button', { name: /Join server/ }).click();
    await expect(b.getByRole('dialog')).toContainText('game connection has not been configured');
    await a.getByRole('button', { name: /My servers/ }).click();
    await a.getByRole('button', { name: 'Delete' }).click();
    await b.reload();
    await expect(b.getByRole('heading', { name: 'Shared Lounge' })).toHaveCount(0);
  } finally { await first.close(); await second.close(); }
});

test('guest profile and servers survive a backend restart', async ({ request }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'condo-db-'));
  let running;
  try {
    running = await startPersistentServer(path.join(dir, 'test.sqlite'));
    const guest = await (await request.post(`${running.base}/api/guests`)).json();
    const headers = { Authorization: `Bearer ${guest.token}` };
    expect((await request.put(`${running.base}/api/profile`, { headers, data: { name: 'Morgan', username: 'morgan' } })).status()).toBe(200);
    const created = await (await request.post(`${running.base}/api/servers`, { headers, data: { name: 'Persistent', image: 'slap', max: 20, visibility: 'private' } })).json();
    await stop(running.process); running = null;
    running = await startPersistentServer(path.join(dir, 'test.sqlite'));
    expect(await (await request.get(`${running.base}/api/profile`, { headers })).json()).toEqual({ name: 'Morgan', username: 'morgan' });
    expect((await (await request.get(`${running.base}/api/servers/mine`, { headers })).json()).servers[0].id).toBe(created.server.id);
  } finally { if (running) await stop(running.process); fs.rmSync(dir, { recursive: true, force: true }); }
});


test('an unlisted server is accessible by link without appearing publicly', async ({ browser }) => {
  const first = await browser.newContext(), second = await browser.newContext();
  try {
    const a = await first.newPage(), b = await second.newPage();
    await a.goto('/play');
    await expect(a.locator('#modeLabel')).toContainText('CONNECTED');
    await a.getByRole('button', { name: 'Create a server', exact: false }).click();
    await a.getByLabel('Server name').fill('Unlisted Lounge');
    await a.getByRole('dialog').getByRole('button', { name: 'Create server' }).click();
    await expect(a.locator('#joinContent')).toContainText('Unlisted Lounge');
    const id = await a.locator('#joinContent p').last().textContent();
    const serverId = id.replace('Server ID: ', '');
    await b.goto('/play');
    await expect(b.getByRole('heading', { name: 'Unlisted Lounge' })).toHaveCount(0);
    await b.goto(`/play?serverid=${encodeURIComponent(serverId)}`);
    await expect(b.locator('#joinContent')).toContainText('Unlisted Lounge');
    await a.getByRole('button', { name: /My servers/ }).click();
    await a.getByRole('button', { name: 'Delete' }).click();
  } finally { await first.close(); await second.close(); }
});

test('a configured website can use an allowed cross-origin backend', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: "window.CONDO_API_BASE_URL = 'http://127.0.0.1:4173';" }));
    await page.goto('http://localhost:4173/play');
    await expect(page.locator('#modeLabel')).toContainText('CONNECTED');
    await page.locator('.profile-panel').getByRole('button', { name: /Edit/ }).click();
    await page.getByLabel('Display name').fill('Cross Origin');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.locator('#profileName')).toContainText('Cross Origin');
    await page.reload();
    await expect(page.locator('#profileName')).toContainText('Cross Origin');
  } finally { await context.close(); }
});


test('a configured but unreachable backend does not show demo data', async ({ page }) => {
  await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: "window.CONDO_API_BASE_URL = 'https://unavailable.invalid';" }));
  await page.route('https://unavailable.invalid/**', route => route.abort());
  await page.goto('/play');
  await expect(page.locator('#modeLabel')).toContainText('OFFLINE');
  await expect(page.locator('#serverGrid')).toContainText('Backend unavailable');
  await expect(page.locator('.server-card')).toHaveCount(0);
});


test('guest supplied names render as text', async ({ page }) => {
  await page.goto('/play');
  await expect(page.locator('#modeLabel')).toContainText('CONNECTED');
  await page.locator('.profile-panel').getByRole('button', { name: /Edit/ }).click();
  await page.getByLabel('Display name').fill('<svg onload=alert(1)>');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('#profileName')).toContainText('<svg onload=alert(1)>');
  await expect(page.locator('#profileName svg')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create a server', exact: false }).click();
  await page.getByLabel('Server name').fill('<img src=x onerror=alert(1)>');
  await page.getByLabel('Visibility').selectOption('public');
  await page.getByRole('dialog').getByRole('button', { name: 'Create server' }).click();
  await expect(page.getByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeVisible();
  await expect(page.locator('.server-title img')).toHaveCount(0);
  await page.getByRole('button', { name: /My servers/ }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
});
