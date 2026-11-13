const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createBackend } = require('./backend');
const root = __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp' };
const allowed = new Set(['index.html', 'styles.css', 'app.js', 'config.js', 'assets/cc.webp', 'assets/slap.webp']);
const backend = createBackend({ databasePath: process.env.DATABASE_PATH || path.join(root, 'data', 'condo.sqlite'), allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean) });
const server = http.createServer(async (req, res) => {
  let url, pathname;
  try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }
  if (await backend.handle(req, res, url)) return;
  const relative = pathname === '/' || pathname === '/play' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!allowed.has(relative)) { res.writeHead(404).end('Not found'); return; }
  fs.readFile(path.resolve(root, relative), (error, data) => {
    if (error) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(relative)] || 'application/octet-stream' }); res.end(data);
  });
});
server.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`Server listening on ${server.address().port}`));
