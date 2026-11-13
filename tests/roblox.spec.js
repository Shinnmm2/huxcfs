const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('owners can add, change, and remove game links; other visitors can join', async ({ browser, request }) => {
  const owner = await browser.newContext(), visitor = await browser.newContext();
  const name = 'Roblox link ' + randomUUID().slice(0, 8);
  let id, ownerToken;
  try {
    const a = await owner.newPage(), b = await visitor.newPage();
    await a.goto('/play');
    await a.getByRole('button', { name: 'Create a server', exact: false }).click();
    await a.getByLabel('Server name').fill(name);
    await a.getByLabel('Visibility').selectOption('public');
    await a.getByLabel('Roblox game URL or Place ID').fill('https://www.roblox.com/games/123456/Test-Game?ref=example');
    await a.getByRole('dialog').getByRole('button', { name: 'Create server' }).click();
    await expect(a.locator('#joinContent')).toContainText(name);
    await b.goto('/play');
    await b.getByRole('heading', { name }).locator('..').locator('..').getByRole('button', { name: /Join server/ }).click();
    const dialog = b.getByRole('dialog');
    await expect(dialog.getByRole('link', { name: 'Open Roblox game' })).toHaveAttribute('href', 'https://www.roblox.com/games/123456');
    await expect(dialog.getByRole('link', { name: /Play in browser/ })).toHaveAttribute('href', 'https://play.roblox.com/games/start?placeId=123456');
    await expect(dialog).toContainText('creator testing beta');
    id = (await (await request.get('/api/servers')).json()).servers.find(server => server.name === name).id;
    ownerToken = await a.evaluate(() => localStorage.getItem('condo-guest-token:' + location.origin));
    const other = await (await request.post('/api/guests')).json();
    const denied = await request.put(`/api/servers/${id}/roblox`, { headers: { Authorization: `Bearer ${other.token}` }, data: { placeId: '7654' } });
    expect(denied.status()).toBe(404);
    await a.getByRole('button', { name: /My servers/ }).click();
    await a.getByRole('button', { name: 'Edit Roblox game' }).click();
    await a.getByLabel('Roblox game URL or Place ID').fill('https://play.roblox.com/games/start?placeId=987654321');
    await a.getByRole('button', { name: 'Save Roblox game' }).click();
    await expect(a.locator('#toast')).toHaveText('Roblox game saved');
    await b.reload();
    await b.getByRole('heading', { name }).locator('..').locator('..').getByRole('button', { name: /Join server/ }).click();
    await expect(b.getByRole('link', { name: /Play in browser/ })).toHaveAttribute('href', 'https://play.roblox.com/games/start?placeId=987654321');
    await a.getByRole('button', { name: /My servers/ }).click();
    await a.getByRole('button', { name: 'Edit Roblox game' }).click();
    await a.getByLabel('Roblox game URL or Place ID').clear();
    await a.getByRole('button', { name: 'Save Roblox game' }).click();
    await expect.poll(async () => (await (await request.get(`/api/servers/${id}`)).json()).server.placeId).toBeUndefined();
    await a.getByRole('button', { name: /My servers/ }).click();
    await a.getByRole('button', { name: 'Delete' }).click();
  } finally { if (id && ownerToken) await request.delete(`/api/servers/${id}`, { headers: { Authorization: `Bearer ${ownerToken}` } }); await owner.close(); await visitor.close(); }
});

test('game inputs reject unsafe and private links in UI and API', async ({ page, request }) => {
  await page.goto('/play');
  await page.getByRole('button', { name: 'Create a server', exact: false }).click();
  await page.getByLabel('Server name').fill('Invalid game');
  for (const bad of ['https://roblox.com.attacker.example/games/123', 'https://www.roblox.com/games/123?privateServerLinkCode=secret', 'javascript:alert(1)', '0']) {
    await page.getByLabel('Roblox game URL or Place ID').fill(bad);
    await page.getByRole('dialog').getByRole('button', { name: 'Create server' }).click();
    await expect(page.locator('#toast')).toContainText('Enter a public Roblox game URL or a numeric Place ID.');
    await expect(page.getByRole('dialog')).toBeVisible();
  }
  const token = (await (await request.post('/api/guests')).json()).token;
  for (const bad of ['https://attacker.example/', '1e10', '0', 123, '123456789012345678901']) {
    const response = await request.post('/api/servers', { headers: { Authorization: `Bearer ${token}` }, data: { name:'Invalid', image:'cc', max:40, visibility:'public', placeId:bad } });
    expect(response.status()).toBe(400);
  }
});

test('demo listings keep game links in this browser', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ status: 404 }));
  await page.goto('/play');
  await page.getByRole('button', { name: 'Create a server', exact: false }).click();
  await page.getByLabel('Server name').fill('Local Roblox');
  await page.getByLabel('Roblox game URL or Place ID').fill('98765');
  await page.getByRole('dialog').getByRole('button', { name: 'Create server' }).click();
  await expect(page.locator('#joinContent')).toContainText('Local Roblox');
  await page.reload();
  await page.getByRole('heading', { name: 'Local Roblox' }).locator('..').locator('..').getByRole('button', { name: /Join server/ }).click();
  await expect(page.getByRole('link', { name: /Play in browser/ })).toHaveAttribute('href', 'https://play.roblox.com/games/start?placeId=98765');
});

test('existing SQLite listings migrate and Roblox links survive a restart', async ({ request }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'condo-migration-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE guests (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT ''); CREATE TABLE servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, image TEXT NOT NULL, max_players INTEGER NOT NULL, owner_hash TEXT NOT NULL REFERENCES guests(token_hash), created_at INTEGER NOT NULL, visibility TEXT NOT NULL DEFAULT 'private'); INSERT INTO guests (token_hash) VALUES ('legacy'); INSERT INTO servers VALUES ('private-00000000-0000-0000-0000-000000000000', 'Legacy', 'cc', 40, 'legacy', 1, 'public');");
  db.close();
  let child;
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd:path.join(__dirname,'..'), env:{ ...process.env, PORT:'0', DATABASE_PATH:dbPath }, stdio:['ignore','pipe','pipe'] });
    return await new Promise((resolve,reject) => { let out=''; const timer=setTimeout(()=>reject(new Error('startup timeout')),10000); child.stdout.on('data',chunk=>{out+=chunk;const match=/Server listening on (\d+)/.exec(out);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}}); child.once('exit',code=>{clearTimeout(timer);reject(new Error(`server exited ${code}`));}); });
  }
  async function stop() { if (child && child.exitCode === null) await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');}); }
  try {
    let base = await start();
    expect((await (await request.get(`${base}/api/servers`)).json()).servers.some(s => s.name === 'Legacy')).toBe(true);
    const token = (await (await request.post(`${base}/api/guests`)).json()).token;
    const created = (await (await request.post(`${base}/api/servers`, { headers:{Authorization:`Bearer ${token}`}, data:{name:'Persistent game',image:'cc',max:40,visibility:'public',placeId:'98765'} })).json()).server;
    await stop(); base = await start();
    expect((await (await request.get(`${base}/api/servers/${created.id}`)).json()).server.placeId).toBe('98765');
  } finally { await stop(); fs.rmSync(dir,{recursive:true,force:true}); }
});
