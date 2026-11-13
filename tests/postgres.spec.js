const { test, expect } = require('@playwright/test');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '0', DB_HOST: process.env.TEST_PG_HOST, DB_PORT: process.env.TEST_PG_PORT, DB_NAME: process.env.TEST_PG_DATABASE, DB_USERNAME: process.env.TEST_PG_USER, DB_PASSWORD: process.env.TEST_PG_PASSWORD || '', DB_TLS_MODE: 'disable' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('PostgreSQL API did not start')); }, 15000);
    child.stderr.on('data', chunk => { errors += chunk; });
    child.stdout.on('data', chunk => { output += chunk; const match = /Server listening on (\d+)/.exec(output); if (match) { clearTimeout(timeout); resolve(Number(match[1])); } });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`PostgreSQL API exited: ${code}. ${errors}`)); });
  });
  return { child, url: `http://127.0.0.1:${port}` };
}
async function stopServer(server) { if (server && server.child.exitCode === null) await new Promise(resolve => { server.child.once('exit', resolve); server.child.kill('SIGTERM'); }); }

test('PostgreSQL persists data and enforces quotas across instances', async ({ request }) => {
  test.skip(!process.env.TEST_PG_HOST, 'Set TEST_PG_* to run against a disposable PostgreSQL database');
  let a, b;
  try {
    [a, b] = await Promise.all([startServer(), startServer()]);
    expect(await (await request.get(`${a.url}/api/health`)).json()).toEqual({ status: 'ok' });
    const guest = await (await request.post(`${a.url}/api/guests`)).json();
    const headers = { Authorization: `Bearer ${guest.token}` };
    expect((await request.put(`${a.url}/api/profile`, { headers, data: { name: 'Postgres Guest', username: 'test' } })).status()).toBe(200);
    const responses = await Promise.all(Array.from({ length: 14 }, (_, i) => request.post(`${i % 2 ? a.url : b.url}/api/servers`, { headers, data: { name: `Server ${i}`, image: 'cc', max: 10, visibility: 'private', placeId: '123456' } })));
    expect(responses.filter(res => res.status() === 201)).toHaveLength(10);
    expect(responses.filter(res => res.status() === 409)).toHaveLength(4);
    await stopServer(a); a = null;
    a = await startServer();
    expect(await (await request.get(`${a.url}/api/profile`, { headers })).json()).toEqual({ name: 'Postgres Guest', username: 'test' });
    const mine = await (await request.get(`${a.url}/api/servers/mine`, { headers })).json();
    expect(mine.servers).toHaveLength(10);
    expect(mine.servers.every(server => server.placeId === '123456')).toBe(true);
    expect((await request.put(`${a.url}/api/servers/${mine.servers[0].id}/roblox`, { headers, data: { placeId: '987654' } })).status()).toBe(200);
    expect((await (await request.get(`${b.url}/api/servers/${mine.servers[0].id}`)).json()).server.placeId).toBe('987654');
    for (const server of mine.servers) expect((await request.delete(`${a.url}/api/servers/${server.id}`, { headers })).status()).toBe(200);
  } finally { await Promise.all([stopServer(a), stopServer(b)]); }
});


test('partial PostgreSQL configuration fails rather than using SQLite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'condo-partial-'));
  try {
    const env = { ...process.env, DB_HOST: '127.0.0.1', DATABASE_PATH: path.join(dir, 'unexpected.sqlite') };
    for (const key of ['DB_PORT', 'DB_NAME', 'DB_USERNAME', 'DB_PASSWORD', 'DB_TLS_MODE', 'DB_CA_CERT']) delete env[key];
    const result = spawnSync(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must all be set');
    expect(fs.existsSync(env.DATABASE_PATH)).toBe(false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
