const { randomBytes, createHash } = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const WORDS = 'apple apricot autumn bamboo beacon berry birch bloom blue breeze bright brook cabin candle cedar cherry cloud clover coral dawn dune eagle ember fern field flame forest frost garden ginger glade globe golden grape harbor hazel honey island ivy jade lake leaf lemon lily maple meadow melon mint moon morning ocean olive orange orchid otter peach pearl pine planet plum river rose ruby sage sky snow solar spring star stone summer sunset violet willow'.split(' ');
const RECOVERY = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const hash = value => createHash('sha256').update(value).digest('hex');
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
function safeTestUrl(value, fallback, env) {
  if (!value) return fallback;
  const url = new URL(value);
  if (env.NODE_ENV !== 'test' || url.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('Verification endpoint overrides are only allowed for loopback tests');
  return url.origin;
}
function createVerification(env) {
  const siteKey = env.TURNSTILE_SITE_KEY || '';
  const secret = env.TURNSTILE_SECRET_KEY || '';
  const hostnames = (env.TURNSTILE_HOSTNAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const isTestKey = /^(?:1x|2x|3x)0{10,}/.test(siteKey) || /^(?:1x|2x|3x)0{10,}/.test(secret);
  const testMode = isTestKey && env.ALLOW_TURNSTILE_TEST_KEYS === '1' && env.NODE_ENV !== 'production';
  const enabled = !!(siteKey && secret && hostnames.length && (!isTestKey || testMode));
  const robloxBase = safeTestUrl(env.ROBLOX_TEST_ORIGIN, 'https://users.roblox.com', env);
  const turnstileBase = safeTestUrl(env.TURNSTILE_TEST_ORIGIN, 'https://challenges.cloudflare.com', env);
  function request(url, options) {
    return new Promise((resolve, reject) => {
      const target = new URL(url), client = target.protocol === 'https:' ? https : http;
      const req = client.request(target, { method: options.method || 'GET', headers: options.headers || {} }, res => {
        let body = '', bytes = 0;
        res.setEncoding('utf8');
        res.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > 1048576) req.destroy(new Error('Response too large')); else body += chunk; });
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, json: async () => JSON.parse(body) }));
        res.on('error', () => reject(failure('Verification service is unavailable. Please try again.', 503)));
      });
      req.setTimeout(10000, () => req.destroy(new Error('Request timed out')));
      req.on('error', () => reject(failure('Verification service is unavailable. Please try again.', 503)));
      if (options.body) req.write(String(options.body));
      req.end();
    });
  }
  async function captcha(token, requestOrigin) {
    if (!enabled) throw failure('Roblox verification is not configured.', 503);
    if (typeof token !== 'string' || token.length < 1 || token.length > 2048) throw failure('Complete the CAPTCHA first.');
    const response = await request(turnstileBase + '/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret, response: token }) });
    if (!response.ok) throw failure('CAPTCHA verification is unavailable. Please try again.', 503);
    const result = await response.json().catch(() => ({}));
    const hostname = String(result.hostname || '').toLowerCase();
    let originHost = '';
    try { if (requestOrigin) originHost = new URL(requestOrigin).hostname.toLowerCase(); } catch (_) {}
    if (result.success !== true || !hostnames.includes(hostname) || (!testMode && (result.action !== 'roblox_verify' || (requestOrigin && hostname !== originHost)))) throw failure('CAPTCHA verification failed. Please try again.');
  }
  async function lookup(username) {
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(username)) throw failure('Enter a valid Roblox username.');
    const response = await request(robloxBase + '/v1/usernames/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }) });
    if (!response.ok) throw failure('Roblox is unavailable. Please try again.', 503);
    const data = await response.json().catch(() => ({}));
    const user = Array.isArray(data.data) ? data.data[0] : null;
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.name !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(user.name)) throw failure('Roblox username not found.');
    return { id: String(user.id), username: user.name };
  }
  async function profileContains(id, phrase) {
    if (!/^\d+$/.test(id)) throw failure('Invalid account.');
    const response = await request(robloxBase + '/v1/users/' + encodeURIComponent(id), {});
    if (!response.ok) throw failure('Roblox is unavailable. Please try again.', 503);
    const data = await response.json().catch(() => ({}));
    return String(data.id) === id && !data.isBanned && typeof data.description === 'string' && data.description.includes(phrase);
  }
  const phrase = () => {
    const result = [], limit = 256 - (256 % WORDS.length);
    while (result.length < 10) for (const byte of randomBytes(16)) { if (byte < limit) result.push(WORDS[byte % WORDS.length]); if (result.length === 10) break; }
    return result.join(' ');
  };
  const recoveryCode = () => Array.from(randomBytes(16), byte => RECOVERY[byte & 31]).join('').match(/.{4}/g).join('-');
  return { enabled, siteKey: enabled ? siteKey : null, testMode, captcha, lookup, profileContains, phrase, recoveryCode, hash };
}
module.exports = { createVerification };
