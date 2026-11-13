const { test, expect } = require('@playwright/test');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomInt } = require('node:crypto');

async function fixture() {
  const id = randomInt(100000000, 2000000000), secondId = id + 1;
  const descriptions = new Map([[String(id), ''], [String(secondId), '']]);
  const provider = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const send = data => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url === '/turnstile/v0/siteverify') {
      const token = new URLSearchParams(body).get('response');
      if (token === 'valid') return send({ success: true, hostname: 'example.com', action: 'roblox_verify' });
      if (token === 'wrong-host') return send({ success: true, hostname: 'other.example', action: 'roblox_verify' });
      if (token === 'wrong-action') return send({ success: true, hostname: 'example.com', action: 'other' });
      return send({ success: false });
    }
    if (req.url === '/v1/usernames/users') {
      const username = JSON.parse(body).usernames[0];
      return send({ data: username === 'TestUser' ? [{ id, name: 'TestUser' }] : username === 'SecondUser' ? [{ id: secondId, name: 'SecondUser' }] : [] });
    }
    const match = /^\/v1\/users\/(\d+)$/.exec(req.url);
    if (match && descriptions.has(match[1])) return send({ id: Number(match[1]), name: match[1] === String(id) ? 'TestUser' : 'SecondUser', description: descriptions.get(match[1]), isBanned: false });
    res.writeHead(404).end();
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  return { provider, descriptions, id: String(id), url: `http://127.0.0.1:${provider.address().port}` };
}
async function startServer(providerUrl, postgres = false, strictCaptcha = false) {
  const env = { ...process.env, NODE_ENV: 'test', PORT: '0', DATABASE_PATH: ':memory:', TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA', TURNSTILE_HOSTNAMES: 'example.com', ALLOW_TURNSTILE_TEST_KEYS: '1', TURNSTILE_TEST_ORIGIN: providerUrl, ROBLOX_TEST_ORIGIN: providerUrl };
  if (strictCaptcha) Object.assign(env, { TURNSTILE_SITE_KEY:'0x-nondummy-sitekey', TURNSTILE_SECRET_KEY:'non-dummy-test-secret', ALLOWED_ORIGINS:'https://example.com', ALLOW_TURNSTILE_TEST_KEYS:'0' });
  for (const key of ['DB_HOST','DB_PORT','DB_NAME','DB_USERNAME','DB_PASSWORD','DB_TLS_MODE','DB_CA_CERT']) delete env[key];
  if (postgres) Object.assign(env, { DB_HOST: process.env.TEST_PG_HOST, DB_PORT: process.env.TEST_PG_PORT, DB_NAME: process.env.TEST_PG_DATABASE, DB_USERNAME: process.env.TEST_PG_USER, DB_PASSWORD: process.env.TEST_PG_PASSWORD || '', DB_TLS_MODE: 'disable' });
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Verification test server did not start')); }, 15000);
    child.stderr.on('data', chunk => { errors += chunk; });
    child.stdout.on('data', chunk => { output += chunk; const match = /Server listening on (\d+)/.exec(output); if (match) { clearTimeout(timeout); resolve(Number(match[1])); } });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Verification test server exited ${code}: ${errors}`)); });
  });
  return { child, url: `http://127.0.0.1:${port}` };
}
async function stopServer(server) { if (server?.child.exitCode === null) await new Promise(resolve => { server.child.once('exit', resolve); server.child.kill('SIGTERM'); }); }
async function closeFixture(f) { await new Promise(resolve => f.provider.close(resolve)); }
async function guest(request, base) { return (await (await request.post(`${base}/api/guests`)).json()).token; }
const headers = token => ({ Authorization: `Bearer ${token}` });

async function exerciseVerification(request, base, f) {
  const a = await guest(request, base), b = await guest(request, base), c = await guest(request, base);
  expect((await request.post(`${base}/api/auth/challenge`, { headers: headers(a), data: { username: 'TestUser', captchaToken: 'bad' } })).status()).toBe(400);
  const challenge = await (await request.post(`${base}/api/auth/challenge`, { headers: headers(a), data: { username: 'TestUser', captchaToken: 'valid' } })).json();
  expect(challenge.phrase.split(' ').length).toBe(10);
  expect((await request.post(`${base}/api/auth/verify`, { headers: headers(b), data: { challengeToken: challenge.challengeToken, captchaToken: 'valid' } })).status()).toBe(410);
  expect((await request.post(`${base}/api/auth/verify`, { headers: headers(a), data: { challengeToken: challenge.challengeToken, captchaToken: 'valid' } })).status()).toBe(400);
  const guestBefore = await (await request.get(`${base}/api/profile`, { headers: headers(a) })).json();
  expect(guestBefore.verified).toBeUndefined();
  f.descriptions.set(f.id, `Profile: ${challenge.phrase}`);
  const successful = await request.post(`${base}/api/auth/verify`, { headers: headers(a), data: { challengeToken: challenge.challengeToken, captchaToken: 'valid' } });
  expect(successful.status()).toBe(200);
  const verified = await successful.json();
  expect(verified.verified).toBe(true);
  expect(verified.recoveryCode).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  expect((await request.post(`${base}/api/auth/verify`, { headers: headers(a), data: { challengeToken: challenge.challengeToken, captchaToken: 'valid' } })).status()).toBe(410);
  const profile = await (await request.get(`${base}/api/profile`, { headers: headers(a) })).json();
  expect(profile.verified).toBe(true); expect(profile.robloxUsername).toBe('TestUser');
  const returning = await guest(request, base);
  const returningChallenge = await (await request.post(`${base}/api/auth/challenge`, { headers: headers(returning), data: { username: 'TestUser', captchaToken: 'valid' } })).json();
  f.descriptions.set(f.id, returningChallenge.phrase);
  const signedIn = await request.post(`${base}/api/auth/verify`, { headers: headers(returning), data: { challengeToken: returningChallenge.challengeToken, captchaToken: 'valid' } });
  expect(signedIn.status()).toBe(200);
  expect(await signedIn.json()).toEqual({ verified: true, robloxUsername: 'TestUser' });
  // Both sessions must resolve to the same saved profile, without issuing another recovery code.
  await request.put(`${base}/api/profile`, { headers: headers(returning), data: { name: 'Returning member', username: '' } });
  expect((await (await request.get(`${base}/api/profile`, { headers: headers(a) })).json()).name).toBe('Returning member');
  const made = await request.post(`${base}/api/servers`, { headers: headers(b), data: { name: 'Before recovery', image: 'cc', max: 10, visibility: 'private', placeId: '123456' } });
  const server = (await made.json()).server;
  expect(server.placeId).toBe('123456');
  const changed = await request.put(`${base}/api/servers/${server.id}/roblox`, { headers: headers(b), data: { placeId: '987654' } });
  expect(changed.status()).toBe(200);
  expect((await changed.json()).server.placeId).toBe('987654');
  const recovered = await request.post(`${base}/api/auth/recover`, { headers: headers(b), data: { recoveryCode: verified.recoveryCode, captchaToken: 'valid' } });
  expect(recovered.status()).toBe(200);
  const rotated = (await recovered.json()).recoveryCode;
  expect(rotated).not.toBe(verified.recoveryCode);
  expect((await request.post(`${base}/api/auth/recover`, { headers: headers(c), data: { recoveryCode: verified.recoveryCode, captchaToken: 'valid' } })).status()).toBe(400);
  const owned = (await (await request.get(`${base}/api/servers/mine`, { headers: headers(a) })).json()).servers;
  expect(owned.some(s => s.id === server.id)).toBe(true);
  expect((await request.delete(`${base}/api/servers/${server.id}`, { headers: headers(b) })).status()).toBe(200);
  expect((await (await request.get(`${base}/api/profile`, { headers: headers(b) })).json()).verified).toBe(true);
}

test('verification is disabled without configured CAPTCHA keys', async ({ request }) => {
  const config = await (await request.get('/api/config')).json();
  expect(config.verification.enabled).toBe(false);
  expect((await request.post('/api/auth/challenge', { data: {} })).status()).toBe(503);
});

test('phrase verification is bound to the browser and recovery codes rotate', async ({ request }) => {
  const f = await fixture(); let server;
  try { server = await startServer(f.url); await exerciseVerification(request, server.url, f); }
  finally { await stopServer(server); await closeFixture(f); }
});

test('PostgreSQL verifies and recovers the same account across sessions', async ({ request }) => {
  test.skip(!process.env.TEST_PG_HOST, 'Set TEST_PG_* for disposable PostgreSQL');
  const f = await fixture(); let server;
  try { server = await startServer(f.url, true); await exerciseVerification(request, server.url, f); }
  finally { await stopServer(server); await closeFixture(f); }
});

test('verification and recovery screens work with synthetic Roblox and CAPTCHA providers', async ({ page, browser }) => {
  const f = await fixture(); let server, second;
  const widget = `(() => { let next = 0, widgets = {}; window.turnstile = { render(el, options) { const id = String(++next); widgets[id] = options; el.textContent = 'Test CAPTCHA'; setTimeout(() => options.callback('valid'), 0); return id; }, remove(id) { delete widgets[id]; }, reset(id) { if (widgets[id]) setTimeout(() => widgets[id] && widgets[id].callback('valid'), 0); } }; })();`;
  try {
    server = await startServer(f.url);
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', route => route.fulfill({ contentType: 'text/javascript', body: widget }));
    await page.goto(`${server.url}/login`);
    await expect(page.getByText('Test CAPTCHA is enabled for this preview.')).toBeVisible();
    await page.getByLabel('Roblox username').fill('TestUser');
    await page.getByRole('button', { name: 'Generate verification phrase' }).click();
    await expect(page.getByRole('heading', { name: 'Paste the phrase in your About' })).toBeVisible();
    const phrase = await page.locator('#verificationPhrase').textContent();
    expect(phrase.split(' ')).toHaveLength(10);
    f.descriptions.set(f.id, phrase);
    await page.getByRole('button', { name: 'Verify account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Account verified!' })).toBeVisible();
    const code = await page.locator('#newRecoveryCode').textContent();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    await page.getByRole('link', { name: /Continue to Home/ }).click();
    await expect(page.locator('.home-guest')).toHaveText('VERIFIED');
    await expect(page.locator('#homeSubtitle')).toContainText('@TestUser');
    await page.goto(`${server.url}/login`);
    await expect(page.getByRole('heading', { name: 'You’re already signed in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
    await expect(page.locator('#verifiedName')).toHaveText('@TestUser');
    await expect(page.locator('#verifyStepOne')).toBeHidden();
    await expect(page.locator('#recoveryResult')).toBeHidden();
    await expect(page.locator('#newRecoveryCode')).toHaveText('');
    // Verified members can still edit their display name without starting verification again.
    await page.goto(`${server.url}/login?guest=1`);
    await expect(page.getByLabel('Display name')).toBeVisible();
    await page.getByRole('button', { name: 'Back to verification' }).click();
    await expect(page.getByRole('heading', { name: 'You’re already signed in' })).toBeVisible();
    second = await browser.newContext(); const other = await second.newPage();
    await other.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', route => route.fulfill({ contentType: 'text/javascript', body: widget }));
    await other.goto(`${server.url}/login`);
    await other.getByRole('button', { name: /Have a recovery code/ }).click();
    await other.getByLabel('Recovery code').fill(code);
    await other.getByRole('button', { name: 'Sign in with recovery code' }).click();
    await expect(other.getByRole('heading', { name: 'Account verified!' })).toBeVisible();
    await expect(other.locator('#newRecoveryCode')).not.toHaveText(code);
  } finally { if (second) await second.close(); await stopServer(server); await closeFixture(f); }
});


async function exerciseConcurrent(request, base, f) {
  const a = await guest(request, base), b = await guest(request, base), c = await guest(request, base), d = await guest(request, base);
  const make = async token => (await (await request.post(`${base}/api/auth/challenge`, { headers: headers(token), data: { username:'TestUser', captchaToken:'valid' } })).json());
  const [one, two] = await Promise.all([make(a), make(b)]);
  f.descriptions.set(f.id, `${one.phrase} ${two.phrase}`);
  const [first, second] = await Promise.all([request.post(`${base}/api/auth/verify`, { headers:headers(a), data:{ challengeToken:one.challengeToken, captchaToken:'valid' } }), request.post(`${base}/api/auth/verify`, { headers:headers(b), data:{ challengeToken:two.challengeToken, captchaToken:'valid' } })]);
  expect(first.status()).toBe(200); expect(second.status()).toBe(200);
  const results = await Promise.all([first.json(), second.json()]);
  const codes = results.map(item => item.recoveryCode).filter(Boolean);
  expect(codes).toHaveLength(1);
  const outcomes = await Promise.all([request.post(`${base}/api/auth/recover`, { headers:headers(c), data:{ recoveryCode:codes[0], captchaToken:'valid' } }), request.post(`${base}/api/auth/recover`, { headers:headers(d), data:{ recoveryCode:codes[0], captchaToken:'valid' } })]);
  expect(outcomes.map(r => r.status()).sort()).toEqual([200, 400]);
  expect((await (await request.get(`${base}/api/profile`, {headers:headers(a)})).json()).robloxId).toBe(f.id);
  expect((await (await request.get(`${base}/api/profile`, {headers:headers(b)})).json()).robloxId).toBe(f.id);
}

test('concurrent verification and recovery are single-use on SQLite', async ({ request }) => {
  const f = await fixture(); let server;
  try { server = await startServer(f.url); await exerciseConcurrent(request, server.url, f); }
  finally { await stopServer(server); await closeFixture(f); }
});

test('concurrent verification and recovery are single-use on PostgreSQL', async ({ request }) => {
  test.skip(!process.env.TEST_PG_HOST, 'Set TEST_PG_* for disposable PostgreSQL');
  const f = await fixture(); let server;
  try { server = await startServer(f.url, true); await exerciseConcurrent(request, server.url, f); }
  finally { await stopServer(server); await closeFixture(f); }
});

test('dummy CAPTCHA keys cannot enable verification in production', () => {
  const { createVerification } = require('../verification');
  const config = createVerification({ NODE_ENV:'production', TURNSTILE_SITE_KEY:'1x00000000000000000000AA', TURNSTILE_SECRET_KEY:'1x0000000000000000000000000000000AA', TURNSTILE_HOSTNAMES:'example.com', ALLOW_TURNSTILE_TEST_KEYS:'1' });
  expect(config.enabled).toBe(false);
});


test('CAPTCHA action and hostname must match when using real keys', async ({ request }) => {
  const f = await fixture(); let server;
  try {
    server = await startServer(f.url, false, true);
    const token = await guest(request, server.url);
    const requestHeaders = { ...headers(token), Origin:'https://example.com' };
    for (const captchaToken of ['wrong-host', 'wrong-action']) {
      const response = await request.post(`${server.url}/api/auth/challenge`, { headers:requestHeaders, data:{ username:'TestUser', captchaToken } });
      expect(response.status()).toBe(400);
    }
    expect((await request.post(`${server.url}/api/auth/challenge`, { headers:requestHeaders, data:{ username:'TestUser', captchaToken:'valid' } })).status()).toBe(201);
  } finally { await stopServer(server); await closeFixture(f); }
});

test('failed phrase attempts eventually expire the challenge', async ({ request }) => {
  const f = await fixture(); let server;
  try {
    server = await startServer(f.url); const token = await guest(request, server.url);
    const challenge = await (await request.post(`${server.url}/api/auth/challenge`, { headers:headers(token), data:{ username:'TestUser', captchaToken:'valid' } })).json();
    for (let i = 0; i < 5; i++) expect((await request.post(`${server.url}/api/auth/verify`, { headers:headers(token), data:{ challengeToken:challenge.challengeToken, captchaToken:'valid' } })).status()).toBe(400);
    f.descriptions.set(f.id, challenge.phrase);
    expect((await request.post(`${server.url}/api/auth/verify`, { headers:headers(token), data:{ challengeToken:challenge.challengeToken, captchaToken:'valid' } })).status()).toBe(410);
  } finally { await stopServer(server); await closeFixture(f); }
});

test('phrase verification works in the Wasmer runtime with PostgreSQL', async ({ request }) => {
  test.skip(!process.env.TEST_WASMER_BIN || !process.env.TEST_PG_HOST, 'Set TEST_WASMER_BIN and TEST_PG_* to test the Wasmer package');
  test.setTimeout(60000);
  const f = await fixture(); let child;
  try {
    const env = {
      NODE_ENV: 'test', PORT: '0', DB_HOST: process.env.TEST_PG_HOST, DB_PORT: process.env.TEST_PG_PORT, DB_NAME: process.env.TEST_PG_DATABASE, DB_USERNAME: process.env.TEST_PG_USER, DB_PASSWORD: process.env.TEST_PG_PASSWORD || '', DB_TLS_MODE: 'disable',
      TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA', TURNSTILE_HOSTNAMES: 'example.com', ALLOW_TURNSTILE_TEST_KEYS: '1', TURNSTILE_TEST_ORIGIN: f.url, ROBLOX_TEST_ORIGIN: f.url,
    };
    const args = ['run', '--net'];
    for (const [key, value] of Object.entries(env)) args.push('--env', `${key}=${value}`);
    args.push('.');
    child = spawn(process.env.TEST_WASMER_BIN, args, { cwd: path.join(__dirname, '..'), env: process.env, stdio: ['ignore','pipe','pipe'] });
    const port = await new Promise((resolve, reject) => {
      let output='', error='';
      const timer=setTimeout(()=>{child.kill();reject(new Error('Wasmer test server did not start'));},30000);
      child.stdout.on('data', chunk=>{output+=chunk;const match=/Server listening on (\d+)/.exec(output);if(match){clearTimeout(timer);resolve(Number(match[1]));}});
      child.stderr.on('data', chunk=>{error+=chunk;});
      child.once('exit', code=>{clearTimeout(timer);reject(new Error(`Wasmer exited ${code}: ${error}`));});
    });
    await exerciseVerification(request, `http://127.0.0.1:${port}`, f);
  } finally {
    if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
    await closeFixture(f);
  }
});

async function exerciseLinkedSessionStorage(postgres) {
  const { createStorage } = require('../storage');
  const { randomUUID } = require('node:crypto');
  const db = postgres ? { host: process.env.TEST_PG_HOST, port: Number(process.env.TEST_PG_PORT), database: process.env.TEST_PG_DATABASE, user: process.env.TEST_PG_USER, password: process.env.TEST_PG_PASSWORD || '' } : undefined;
  const store = await createStorage({ databasePath: ':memory:', database: db });
  const a = randomUUID(), b = randomUUID(), challenge = randomUUID(), recovery = randomUUID(), id = randomUUID();
  try {
    await store.createGuest(a); await store.createGuest(b);
    const now = Date.now();
    await store.createChallenge({ hash: challenge, sessionHash: a, id, username: 'TestUser', phrase: 'synthetic', now, expiresAt: now + 60000 });
    await store.completeChallenge({ hash: challenge, sessionHash: a, now, recoveryHash: recovery });
    await store.recover({ sessionHash: b, oldHash: recovery, newHash: randomUUID() });
    // An operation holding the original session ID must resolve the new owner at execution time.
    await store.createServer({ id, name: 'After link', image: 'cc', max: 10, visibility: 'private' }, b);
    expect((await store.listMine(a)).map(row => row.id)).toContain(id);
    await store.updateGuest('Linked name', '', b);
    expect((await store.getGuest(a)).name).toBe('Linked name');
    expect(await store.deleteServer(id, b)).toBe(true);
  } finally { await store.close(); }
}

test('SQLite changes follow a session after account linking', async () => {
  await exerciseLinkedSessionStorage(false);
});

test('PostgreSQL changes follow a session after account linking', async () => {
  test.skip(!process.env.TEST_PG_HOST, 'Set TEST_PG_* for disposable PostgreSQL');
  await exerciseLinkedSessionStorage(true);
});
