const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createBackend } = require('./backend');
const root = __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp' };
const allowed = new Set(['index.html', 'home.html', 'login.html', 'create.html', 'styles.css', 'app.js', 'account.js', 'create.js', 'config.js', 'assets/cc.webp', 'assets/slap.webp']);
function postgresConfig(env) {
  const configured = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USERNAME', 'DB_PASSWORD', 'DB_TLS_MODE', 'DB_CA_CERT'].some(key => !!env[key]);
  if (!configured) return null;
  if (!env.DB_HOST || !env.DB_PORT || !env.DB_NAME || !env.DB_USERNAME) throw new Error('DB_HOST, DB_PORT, DB_NAME and DB_USERNAME must all be set');
  const port = Number(env.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT must be a valid port');
  const mode = env.DB_TLS_MODE || 'verify';
  let ssl;
  if (mode === 'verify') ssl = { rejectUnauthorized: true, ...(env.DB_CA_CERT ? { ca: env.DB_CA_CERT } : {}) };
  else if (mode === 'unverified') ssl = { rejectUnauthorized: false };
  else if (mode === 'disable' && ['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST)) ssl = false;
  else throw new Error('Invalid DB_TLS_MODE; disable is only supported for local testing');
  return { host: env.DB_HOST, port, database: env.DB_NAME, user: env.DB_USERNAME, password: env.DB_PASSWORD || undefined, ssl };
}
async function start() {
const backend = await createBackend({ databasePath: process.env.DATABASE_PATH || path.join(root, 'data', 'condo.sqlite'), database: postgresConfig(process.env), allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean) });
const server = http.createServer(async (req, res) => {
  let url, pathname;
  try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }
  if (await backend.handle(req, res, url)) return;
  const relative = pathname === '/' || pathname === '/play' ? 'index.html' : pathname === '/home' ? 'home.html' : pathname === '/login' ? 'login.html' : pathname === '/create' ? 'create.html' : pathname.replace(/^\/+/, '');
  if (!allowed.has(relative)) { res.writeHead(404).end('Not found'); return; }
  fs.readFile(path.resolve(root, relative), (error, data) => {
    if (error) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(relative)] || 'application/octet-stream' }); res.end(data);
  });
});
server.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`Server listening on ${server.address().port}`));
}
start().catch(error => { console.error('Database initialization failed:', error.message); process.exitCode = 1; });
