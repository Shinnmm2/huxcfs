const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let server;
let origin;
test.beforeAll(async () => {
  const files = new Map([
    ['/huxcfs/', ['index.html', 'text/html']],
    ['/huxcfs/app.js', ['app.js', 'text/javascript']],
    ['/huxcfs/config.js', ['config.js', 'text/javascript']],
    ['/huxcfs/styles.css', ['styles.css', 'text/css']],
    ['/huxcfs/assets/cc.webp', ['assets/cc.webp', 'image/webp']],
    ['/huxcfs/assets/slap.webp', ['assets/slap.webp', 'image/webp']],
  ]);
  server = http.createServer((req, res) => {
    const file = files.get(new URL(req.url, 'http://localhost').pathname);
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': file[1] });
    res.end(fs.readFileSync(path.join(__dirname, '..', '_site', file[0])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

test('Pages bundle works under the repository path, including navigation and sharing', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await page.goto(`${origin}/huxcfs/`);
  await expect(page.locator('.server-card')).toHaveCount(6);
  expect((await page.request.get(`${origin}/huxcfs/styles.css`)).status()).toBe(200);
  expect((await page.request.get(`${origin}/huxcfs/assets/cc.webp`)).status()).toBe(200);
  await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute('href', 'styles.css');
  expect(await page.locator('.server-card .map-image').first().evaluate(el => getComputedStyle(el).backgroundImage)).toContain('/assets/cc.webp');
  await page.locator('[data-select="general"]').click();
  await page.getByRole('button', { name: 'Share link' }).click();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared).toBe(`${origin}/huxcfs/?serverid=general`);
  await page.goto(shared);
  await expect(page.locator('#joinContent')).toContainText('General Server');
  await page.getByRole('link', { name: /Servers/ }).click();
  await expect(page).toHaveURL(`${origin}/huxcfs/`);
  await expect(page.locator('.server-card')).toHaveCount(6);
});
