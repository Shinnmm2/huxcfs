const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp' };
http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }
  const relative = pathname === '/' || pathname === '/play' ? 'index.html' : pathname.replace(/^\/+/, '');
  const allowed = new Set(['index.html', 'styles.css', 'app.js', 'assets/cc.webp', 'assets/slap.webp']);
  if (!allowed.has(relative)) { res.writeHead(404).end('Not found'); return; }
  const file = path.resolve(root, relative);
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
}).listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`Server listening on ${process.env.PORT || 3000}`));
