const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, '_site');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
for (const file of ['index.html', 'home.html', 'login.html', 'styles.css', 'app.js', 'account.js', 'assets/cc.webp', 'assets/slap.webp']) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}

const apiBase = (process.env.CONDO_API_BASE_URL || '').trim();
if (apiBase) {
  const url = new URL(apiBase);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('CONDO_API_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment');
}
fs.writeFileSync(path.join(out, 'config.js'), `window.CONDO_API_BASE_URL = ${JSON.stringify(apiBase).replace(/</g, '\\u003c')};\n`);
